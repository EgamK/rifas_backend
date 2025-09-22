import { Request, Response } from "express";
import mongoose from "mongoose";
import Raffle from "../models/Raffle";
import Purchase from "../models/Purchase";
import Referido from "../models/referidos";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";

const uploadBufferToCloudinary = (buffer: Buffer, filename?: string) => {
  return new Promise<any>((resolve, reject) => {
    const cld_upload_stream = cloudinary.uploader.upload_stream(
      { folder: "rifas" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(cld_upload_stream);
  });
};

// 📌 List raffles
export const listRaffles = async (_req: Request, res: Response) => {
  const raffles = await Raffle.find().lean();
  res.json(raffles);
};

// 📌 Get raffle by ID
export const getRaffle = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ error: "Id inválido" });

  try {
    const raffle = await Raffle.findById(id).lean();
    if (!raffle) return res.status(404).json({ error: "Rifa no encontrada" });

    // contar compras confirmadas (PAID)
    const confirmedCountAgg = await Purchase.aggregate([
      { $match: { raffleId: raffle._id, status: "PAID" } },
      { $group: { _id: null, totalQuantity: { $sum: "$quantity" } } },
    ]);

    const confirmedTickets = confirmedCountAgg[0]?.totalQuantity || 0;

    res.json({
      ...raffle,
      confirmedTickets,
    });
  } catch (err) {
    console.error("getRaffle error:", err);
    res.status(500).json({ error: "Error obteniendo rifa" });
  }
};

// 📌 Create raffle (Admin)
export const createRaffle = async (req: Request, res: Response) => {
  try {
    const { title, description, ticketPrice, totalTickets } = req.body;
    const files = req.files as Express.Multer.File[] | undefined;

    let photos: string[] = [];
    if (files && files.length > 0) {
      const uploads = [];
      for (const f of files) {
        uploads.push(uploadBufferToCloudinary(f.buffer));
      }
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
    console.error(err);
    res.status(500).json({ error: "Error creando rifa" });
  }
};

// 📌 Create purchase (guest)
export const createPurchase = async (req: Request, res: Response) => {
  const { id } = req.params; // raffle id
  const { name, dni, phone, email, quantity, operationNumber, codRef } = req.body;

  const q = Number(quantity || 1);

  if (!name || !dni || !phone || !email || !operationNumber) {
    return res
      .status(400)
      .json({ error: "Faltan campos obligatorios (incluye operationNumber)" });
  }
  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ error: "Id inválido" });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const raffle = await Raffle.findById(id).session(session);
    if (!raffle) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Rifa no encontrada" });
    }

    // ✅ validar si operationNumber ya existe
    const existingOp = await Purchase.findOne({ operationNumber }).session(session);
    if (existingOp) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Número de operación ya registrado" });
    }

    // ✅ validar referencia (si viene en la compra)
    let codRefToSave: string | null = null;
    let discount = 0;
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
      // ✅ aplicar 12% sobre el subtotal (no sobre un solo ticket)
      // calculará correctamente para q > 1
      // ejemplo: q=2, ticketPrice=25 => baseAmount=50, discount=50*0.12=6 => final=44
      const DISCOUNT_RATE = 0.12;
      // notar: calculamos luego cuando tengamos baseAmount (más abajo)
      // aquí solo marcamos que existe un referido
    }

    // ✅ verificar disponibilidad
    if (raffle.soldTickets + q > raffle.totalTickets) {
      await session.abortTransaction();
      return res.status(400).json({ error: "No hay suficientes tickets disponibles" });
    }

    // ✅ asignar números secuenciales
    const start = raffle.soldTickets + 1;
    const tickets = Array.from({ length: q }, (_, i) => start + i);

    // ✅ calcular monto con o sin descuento CORRECTAMENTE
    const baseAmount = q * raffle.ticketPrice;
    if (codRefToSave) {
      // aplicar 12% sobre el subtotal
      discount = Number((baseAmount * 0.12).toFixed(2));
    } else {
      discount = 0;
    }
    // redondeo seguro a 2 decimales
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
          amount: finalAmount, // ✅ guardar el monto real con descuento aplicado
          tickets,
          method: "yape",
          status: "PENDING",
          operationNumber,
          codRef: codRefToSave,
        },
      ],
      { session }
    );

    //raffle.soldTickets += q;
    //await raffle.save({ session });

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
      return res.status(400).json({ error: "Número de operación ya registrado" });
    }
    return res.status(500).json({ error: "Error creando compra" });
  }
};

// 📌 List all purchases (admin)
export const listPurchases = async (_req: Request, res: Response) => {
  try {
    const purchases = await Purchase.find()
      .populate("raffleId", "title")
      .lean();

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
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error listando compras" });
  }
};

// 📌 Confirm purchase (admin)
export const confirmPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    purchase.status = "PAID";
    await purchase.save();

    res.json({ message: "Compra confirmada", purchase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error confirmando compra" });
  }
};

// 📌 Reject purchase (admin)
export const rejectPurchase = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  try {
    const purchase = await Purchase.findById(id);
    if (!purchase) return res.status(404).json({ error: "Compra no encontrada" });

    purchase.status = "FAILED";
    await purchase.save();

    res.json({ message: "Compra rechazada", purchase });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error rechazando compra" });
  }
};

// 📌 Validate referido (para frontend)
export const validateReferido = async (req: Request, res: Response) => {
  const { code } = req.params;
  try {
    const ref = await Referido.findOne({ codRef: code });
    if (!ref) {
      return res.json({ valid: false });
    }
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

