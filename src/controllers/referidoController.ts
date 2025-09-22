import { Request, Response } from "express";
import Referido from "../models/referidos";

export const validarCodigoRef = async (req: Request, res: Response) => {
  try {
    const { codRef } = req.params;

    const ref = await Referido.findOne({ codRef }).lean();

    if (!ref) {
      return res.status(404).json({ valid: false, message: "Código no existe" });
    }

    const now = new Date();
    if (ref.startAt && ref.startAt > now) {
      return res.status(400).json({ valid: false, message: "Código aún no activo" });
    }
    if (ref.endAt && ref.endAt < now) {
      return res.status(400).json({ valid: false, message: "Código expirado" });
    }

    return res.json({ valid: true, message: "Código válido", ref });
  } catch (err) {
    console.error("validarCodigoRef error:", err);
    res.status(500).json({ valid: false, message: "Error en servidor" });
  }
};
