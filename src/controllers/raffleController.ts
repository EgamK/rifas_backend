import { Request, Response } from "express";
import mongoose from "mongoose";
import Raffle from "../models/Raffle";
import Purchase from "../models/Purchase";
import Referido from "../models/referidos";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";
import { z } from "zod";
import nodemailer from "nodemailer";
import { Types } from "mongoose";

const smtpHost = process.env.SMTP_HOST || "smtp.zoho.com";
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = process.env.SMTP_USER || "ventas@rifasganaya.pe";
const smtpPass = process.env.SMTP_PASS || "";

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465, // true para 465
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

// utilitaria para enviar correo (no rompe la lógica si falla; registramos error)
async function sendEmail(to: string, subject: string, text: string) {
  try {
    const info = await transporter.sendMail({
      from: `"Rifas Gana Ya" <${smtpUser}>`,
      to,
      subject,
      text,
    });
    return { ok: true, info };
  } catch (err: any) {
    console.error("Error enviando email:", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// --------------------- Zod schema ---------------------
const purchaseSchema = z.object({
  name: z.string().min(1).transform((v) => v.toUpperCase()),
  dni: z.string().regex(/^[0-9]{8,9}$/, "DNI inválido"),
  phone: z.string().regex(/^[0-9]{9}$/, "Teléfono inválido"),
  email: z.string().email("Email inválido"),
  quantity: z.coerce.number().min(1),
  operationNumber: z.string().min(1),
  codRef: z.string().optional().nullable(),
});

// --------------------- util cloudinary ---------------------
const uploadBufferToCloudinary = (buffer: Buffer) => {
  return new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "rifas" }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// --------------------- Controllers (sin cambiar diseño ni criterios) ---------------------

export const listRaffles = async (_req: Request, res: Response) => {
  const raffles = await Raffle.find().lean();
  res.json(raffles);
};

export const getRaffle = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Id inválido" });

  try {
    const raffle = await Raffle.findById(id).lean();
    if (!raffle) return res.status(404).json({ error: "Rifa no encontrada" });

    const confirmedCountAgg = await Purchase.aggregate([
      { $match: { raffleId: raffle._id, status: "PAID" } },
      { $group: { _id: null, totalQuantity: { $sum: "$quantity" } } },
    ]);

    const confirmedTickets = confirmedCountAgg[0]?.totalQuantity || 0;

    res.json({ ...raffle, confirmedTickets });
  } catch (err) {
    console.error("getRaffle error:", err);
    res.status(500).json({ error: "Error obteniendo rifa" });
  }
};

export const createRaffle = async (req: Request, res: Response) => {
  try {
    const { title, description, ticketPrice, totalTickets } = req.body;
    const files = req.files as Express.Multer.File[] | undefined;

    let photos: string[] = [];
    if (files && files.length > 0) {
      const uploads = files.map((f) => uploadBufferToCloudinary(f.buffer));
      const results = await Promise.all(uploads);
      photos = results.map((r) => r.secure_url);
    }

    const raffle = await Raffle.create({
      title,
      description,
      ticketPrice: Number(ticketPrice),
      totalTickets: Number(totalTickets),
      photos,
    });

    res.status(201).json(raffle);
  } catch (err) {
    console.error("createRaffle error:", err);
    res.status(500).json({ error: "Error creando rifa" });
  }
};

export const createPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;
  let validated;
  try {
    validated = purchaseSchema.parse(req.body);
  } catch (error: any) {
    return res.status(400).json({ error: "Validación fallida", details: error.errors });
  }

  const { name, dni, phone, email, quantity, operationNumber, codRef } = validated;
  const q = Number(quantity);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ✅ validar rifa
    const raffleExist = await Raffle.findById(id).session(session);
    if (!raffleExist) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Rifa no encontrada" });
    }

    // ✅ validar número de operación único
    const existingOp = await Purchase.findOne({ operationNumber }).session(session);
    if (existingOp) {
      await session.abortTransaction();
      return res.status(400).json({ field: "operationNumber", error: "Número de operación ya registrado" });
    }

    // ✅ validar referido (si aplica)
    let codRefToSave: string | null = null;
    if (codRef && codRef.trim() !== "") {
      const ref = await Referido.findOne({ codRef }).session(session);
      if (!ref) {
        await session.abortTransaction();
        return res.status(400).json({ error: "Código de referencia inválido" });
      }
      const now = new Date();
      if (ref.startAt && ref.startAt > now) {
        await session.abortTransaction();
        return res.status(400).json({ error: "Código aún no activo" });
      }
      if (ref.endAt && ref.endAt < now) {
        await session.abortTransaction();
        return res.status(400).json({ error: "Código expirado" });
      }
      codRefToSave = ref.codRef;
    }

    // ✅ validar límite SOLO con confirmados
    const confirmedCount = await Purchase.countDocuments({
      raffleId: id,
      status: "PAID"
    }).session(session);

    if (confirmedCount + q > raffleExist.totalTickets) {
      await session.abortTransaction();
      return res.status(400).json({ error: "No hay suficientes tickets disponibles (confirmados)" });
    }

    // ✅ contar todas las compras (para correlativos, aunque estén pendientes/rechazadas)
    //const totalCount = await Purchase.countDocuments({ raffleId: id }).session(session);

    // ✅ generar correlativos seguros
    //const start = 1000 + totalCount + 1;

    // ✅ contar el total de tickets generados hasta ahora (más preciso)
    const totalTicketsUsedAgg = await Purchase.aggregate([
      { $match: { raffleId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]).session(session);

    const totalTicketsUsed = totalTicketsUsedAgg[0]?.total || 0;

    // ✅ generar correlativos seguros
    const start = 1000 + totalTicketsUsed + 1;
    const firstDniDigit = String(dni).charAt(0);
    const lastOpDigit = String(operationNumber).slice(-1);

    const tickets = Array.from({ length: q }, (_, i) => {
      const correlativo = start + i;
      return `${firstDniDigit}${lastOpDigit}${correlativo}`;
    });

    // ✅ calcular montos
    const baseAmount = q * raffleExist.ticketPrice;
    const discount = codRefToSave ? Number((baseAmount * 0.12).toFixed(2)) : 0;
    const finalAmount = Number((baseAmount - discount).toFixed(2));

    // ✅ registrar compra con estado PENDING
    const [purchase] = await Purchase.create(
      [
        {
          raffleId: raffleExist._id,
          name,
          dni,
          phone,
          email,
          quantity: q,
          amount: finalAmount,
          tickets,
          method: "yape",
          status: "PENDING",
          operationNumber,
          codRef: codRefToSave,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      purchaseId: purchase._id,
      tickets,
      amount: finalAmount,
      codRef: codRefToSave,
    });
  } catch (err: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("createPurchase error:", err);
    if (err.code === 11000 && err.keyPattern?.operationNumber) {
      return res.status(400).json({ field: "operationNumber", error: "Número de operación ya registrado" });
    }
    return res.status(500).json({ error: "Error creando compra" });
  }
};

export const listPurchases = async (_req: Request, res: Response) => {
  try {
    const purchases = await Purchase.aggregate([
      // traer rifa
      {
        $lookup: {
          from: "raffles",
          localField: "raffleId",
          foreignField: "_id",
          as: "raffle",
        },
      },
      { $unwind: { path: "$raffle", preserveNullAndEmptyArrays: true } },

      // traer referido por el campo codRef (string)
      {
        $lookup: {
          from: "referidos", // colección de Referido
          localField: "codRef",
          foreignField: "codRef",
          as: "referido",
        },
      },
      { $unwind: { path: "$referido", preserveNullAndEmptyArrays: true } },

      // proyectar sólo lo que necesitamos
      {
        $project: {
          raffleTitle: "$raffle.title",
          name: 1,
          dni: 1,
          phone: 1,
          email2: 1,
          quantity: 1,
          amount: 1,
          tickets: 1,
          method: 1,
          status: 1,
          operationNumber: 1,
          codRef: 1,
          nameRef: "$referido.name",
          emailRef: "$referido.email",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    // devuelve el resultado tal cual (ya tiene las propiedades esperadas)
    res.json(purchases);
  } catch (err) {
    console.error("listPurchases error:", err);
    res.status(500).json({ error: "Error listando compras" });
  }
};


// Confirm purchase (admin) -> además envía correo y devuelve mensaje
export const confirmPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    // ✅ Cambiar estado a PAID si aún no está confirmado
    if (purchase.status !== "PAID") {
      purchase.status = "PAID";
      await purchase.save();

      const raffle = await Raffle.findById(purchase.raffleId);
      if (raffle) {
        raffle.soldTickets += purchase.quantity;
        await raffle.save();
      }
    }

    // ✅ Buscar rifa
    const raffle = await Raffle.findById(purchase.raffleId);

    // ✅ Mensaje para cliente
    const emailMessage = `Hola, ${purchase.name}, 
    
✅ Su pago ha sido confirmado con éxito. 
📌 Usted ya participa en la rifa: ${raffle?.title || "Sin título"}.
🎟️ Números de ticket: ${purchase.tickets.length > 0 ? purchase.tickets.join(", ") : "-"}.
💵 Monto pagado: S/. ${purchase.amount}
📅 Fecha de registro: ${new Date(purchase.createdAt).toLocaleDateString("es-PE")}

🎉 ¡Gracias por confiar en Rifas Gana Ya! 🍀
Te deseamos mucha suerte en el sorteo. Muy pronto te avisaremos la fecha.

Atte. Rifas Gana Ya
📞 Cel: 976476422
✉️ ventas@rifasganaya.pe`;

    // ✅ Buscar referido (IMPORTANTE: buscar por codRef, no por _id)
    let emailMessageRef: string | null = null;
    let sendResultRef: any = null;

    if (purchase.codRef) {
      const ref = await Referido.findOne({ codRef: purchase.codRef });

      if (ref) {
        emailMessageRef = `Felicidades!! ${ref.name}, 
        
El cliente ${purchase.name} ha comprado boletos de rifa usando tu código de referido y por ello estás acumulando el 18% del valor de esta venta.
📌 El cliente participará en el sorteo de: ${raffle?.title || "Sin título"}.
🎟️ Cantidad de ticket: ${purchase.quantity}.
📅 Fecha de registro: ${new Date(purchase.createdAt).toLocaleDateString("es-PE")}

🎉 ¡Gracias por confiar en Rifas Gana Ya! 🍀
    Pronto serás recompensado.

Atte. Rifas Gana Ya
📞 Cel: 976476422
✉️ ventas@rifasganaya.pe`;

        sendResultRef = await sendEmail(
          ref.email,
          "Confirmación de Compra - Rifas Gana Ya (Referido)",
          emailMessageRef
        );
      }
    }

    // ✅ Enviar correo al cliente
    const sendResult = await sendEmail(
      purchase.email,
      "Confirmación de Compra - Rifas Gana Ya",
      emailMessage
    );

    return res.json({
      message: "Compra confirmada",
      purchase,
      emailSent: sendResult.ok,
      emailSentRef: sendResultRef ? sendResultRef.ok : null,
      emailError: sendResult.ok ? null : sendResult.error,
      emailErrorRef: sendResultRef && !sendResultRef.ok ? sendResultRef.error : null,
      emailMessage,
      emailMessageRef,
    });
  } catch (err) {
    console.error("confirmPurchase error:", err);
    res.status(500).json({ error: "Error confirmando compra" });
  }
};


// Reject purchase (admin) -> envía correo notificando rechazo
export const rejectPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    // ✅ Si ya estaba confirmada, devolvemos los tickets
    if (purchase.status === "PAID") {
      const raffle = await Raffle.findById(purchase.raffleId);
      if (raffle) {
        raffle.soldTickets = Math.max(0, raffle.soldTickets - purchase.quantity);
        await raffle.save();
      }
    }

    // ✅ Cambiar estado a FAILED
    purchase.status = "FAILED";
    await purchase.save();

    // ✅ Buscar rifa para el mensaje
    const raffle = await Raffle.findById(purchase.raffleId);

    // ✅ Mensaje al cliente
    const emailMessage = `Estimado/a ${purchase.name},
     
      Tu compra de boletos para la rifa ${raffle?.title || "Sin título"} no pudo ser procesada porque encontramos inconsistencias en el número de operación y/o en los montos de pago.

      No te preocupes, puedes revisarlo y volver a intentarlo. Si necesitas ayuda, nuestro equipo está listo para apoyarte.

      Atte. Rifas Gana Ya
      📞 Cel: 976476422
      ✉️ ventas@rifasganaya.pe`;

    const sendResult = await sendEmail(
      purchase.email,
      "Compra Rechazada - Rifas Gana Ya",
      emailMessage
    );

    // ✅ Notificación al referido (si existiera)
    let emailMessageRef: string | null = null;
    let sendResultRef: any = null;

    if (purchase.codRef) {
      const ref = await Referido.findOne({ codRef: purchase.codRef });

      if (ref) {
        emailMessageRef = `Hola ${ref.name},

        Lamentamos informarte que la compra de boletos para la rifa: ${raffle?.title || "Sin título"}, fue rechazada debido a inconsistencias detectadas en el número de operación y/o en los montos de pago.
        Cliente: ${purchase.name}
        🎟️ Cantidad de ticket: ${purchase.quantity}.
        📅 Fecha de registro: ${new Date(purchase.createdAt).toLocaleDateString("es-PE")}


        Atte. Rifas Gana Ya
        📞 Cel: 976476422
        ✉️ ventas@rifasganaya.pe`;

        sendResultRef = await sendEmail(
          ref.email,
          "Compra Rechazada de tu referido - Rifas Gana Ya",
          emailMessageRef
        );
      }
    }

    return res.json({
      message: "Compra rechazada",
      purchase,
      emailSent: sendResult.ok,
      emailSentRef: sendResultRef ? sendResultRef.ok : null,
      emailError: sendResult.ok ? null : sendResult.error,
      emailErrorRef: sendResultRef && !sendResultRef.ok ? sendResultRef.error : null,
      emailMessage,
      emailMessageRef,
    });
  } catch (err) {
    console.error("rejectPurchase error:", err);
    res.status(500).json({ error: "Error rechazando compra" });
  }
};


export const validateReferido = async (req: Request, res: Response) => {
  const { code } = req.params;
  try {
    const ref = await Referido.findOne({ codRef: code });
    if (!ref) return res.json({ valid: false });
    const now = new Date();
    if ((ref.startAt && ref.startAt > now) || (ref.endAt && ref.endAt < now)) {
      return res.json({ valid: false });
    }
    return res.json({ valid: true });
  } catch (err) {
    console.error("validateReferido error:", err);
    return res.status(500).json({ valid: false, error: "Error validando código" });
  }
};
