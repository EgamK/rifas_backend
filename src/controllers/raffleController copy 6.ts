import { Request, Response } from "express";
import mongoose from "mongoose";
import Raffle from "../models/Raffle";
import Purchase from "../models/Purchase";
import Referido from "../models/referidos";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";
import { z } from "zod";
import nodemailer from "nodemailer";

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

  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Id inválido" });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const raffle = await Raffle.findById(id).session(session);
    if (!raffle) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Rifa no encontrada" });
    }

    // validar operationNumber único
    const existingOp = await Purchase.findOne({ operationNumber }).session(session);
    if (existingOp) {
      await session.abortTransaction();
      return res.status(400).json({ field: "operationNumber", error: "Número de operación ya registrado" });
    }

    // validar referido (si aplica)
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

    // verificar disponibilidad
    if (raffle.soldTickets + q > raffle.totalTickets) {
      await session.abortTransaction();
      return res.status(400).json({ error: "No hay suficientes tickets disponibles" });
    }

    // contar todos los boletos ya asignados (sin importar estado)
    const totalTicketsUsedAgg = await Purchase.aggregate([
      { $match: { raffleId: raffle._id } },
      { $group: { _id: null, totalQuantity: { $sum: "$quantity" } } },
    ]).session(session);

    const totalTicketsUsed = totalTicketsUsedAgg[0]?.totalQuantity || 0;

    // correlativo inicia en 1000 + último ticket asignado
    const start = 1000 + totalTicketsUsed + 1;

    const firstDniDigit = String(dni).charAt(0);
    const lastOpDigit = String(operationNumber).charAt(String(operationNumber).length - 1);

    const tickets = Array.from({ length: q }, (_, i) => {
      const correlativo = start + i;
      return `${firstDniDigit}${lastOpDigit}${correlativo}`;
    });

    const baseAmount = q * raffle.ticketPrice;
    const discount = codRefToSave ? Number((baseAmount * 0.12).toFixed(2)) : 0;
    const finalAmount = Number((baseAmount - discount).toFixed(2));

    const [purchase] = await Purchase.create(
      [
        {
          raffleId: raffle._id,
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
    const purchases = await Purchase.find().populate("raffleId", "title").populate("codRef", "name email").lean();
    
    const formatted = purchases.map((p: any) => ({
      _id: p._id,
      raffleTitle: p.raffleId?.title || "Sin título",
      name: p.name,
      dni: p.dni,
      phone: p.phone,
      email: p.email,
      quantity: p.quantity,
      amount: p.amount,
      tickets: p.tickets,
      method: p.method,
      status: p.status,
      operationNumber: p.operationNumber,
      codRef: p.codRef || null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      nameRef: p.codRef?.name || null,
      emailRef: p.codRef?.email || null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("listPurchases error:", err);
    res.status(500).json({ error: "Error listando compras" });
  }
};

// Confirm purchase (admin) -> además envía correo y devuelve mensaje
export const confirmPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Id inválido" });

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    if (purchase.status !== "PAID") {
      purchase.status = "PAID";
      await purchase.save();

      const raffle = await Raffle.findById(purchase.raffleId);
      if (raffle) {
        raffle.soldTickets += purchase.quantity;
        await raffle.save();
      }
    }

    // Construir mensaje profesional (y legible) para correo y WhatsApp
    const ticketsList = Array.isArray(purchase.tickets) ? purchase.tickets.join(", ") : String(purchase.tickets);
    const raffle = await Raffle.findById(purchase.raffleId);
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
    // Enviar correo (no hacemos que falle la petición si email falla; lo registramos)
    const sendResult = await sendEmail(purchase.email, "Confirmación de Compra - Rifas Gana Ya", emailMessage);

    return res.json({
      message: "Compra confirmada",
      purchase,
      emailSent: sendResult.ok,
      emailError: sendResult.ok ? null : sendResult.error,
      emailMessage,
    });
  } catch (err) {
    console.error("confirmPurchase error:", err);
    res.status(500).json({ error: "Error confirmando compra" });
  }
};

// Reject purchase (admin) -> envía correo notificando rechazo
export const rejectPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Id inválido" });

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    if (purchase.status === "PAID") {
      const raffle = await Raffle.findById(purchase.raffleId);
      if (raffle) {
        raffle.soldTickets = Math.max(0, raffle.soldTickets - purchase.quantity);
        await raffle.save();
      }
    }

    purchase.status = "FAILED";
    await purchase.save();

    // Construir mensaje de rechazo
    const raffle = await Raffle.findById(purchase.raffleId);
    const emailMessage = `Estimado/a ${purchase.name},

      ⚠️ Su compra en la rifa: ${raffle?.title || "Sin título"} no ha podido ser confirmada. 
      El motivo es una inconsistencia en el número de operación o en el monto del pago.

      Le pedimos que por favor verifique el pago y registre el número de operación de manera correcta.

      Atte. Rifas Gana Ya
      📞 Cel: 976476422
      ✉️ ventas@rifasganaya.pe`;

    const sendResult = await sendEmail(purchase.email, "Compra Rechazada - Rifas Gana Ya", emailMessage);

    return res.json({
      message: "Compra rechazada",
      purchase,
      emailSent: sendResult.ok,
      emailError: sendResult.ok ? null : sendResult.error,
      emailMessage,
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
