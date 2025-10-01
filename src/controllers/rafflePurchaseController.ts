
import { Request, Response } from "express";
import Purchase, { IPurchase } from "../models/Purchase";
import rateLimit from "express-rate-limit";

// 🌟 Rate Limiter: máximo 10 consultas cada 60 segundos por IP
export const purchaseSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: "Has alcanzado el límite de consultas. Intenta nuevamente en un minuto.",
  },
});

interface PurchaseWithRaffle extends Omit<IPurchase, "raffleId"> {
  raffleId: { _id: string; title: string };
}

export const searchPurchases = async (req: Request, res: Response) => {
  try {
    const { dni, numeroOperacion, numeroRifa } = req.query;

    // 1️⃣ Validación de entrada
    if (!dni && !numeroOperacion && !numeroRifa) {
      return res.status(400).json({
        error: "Debes ingresar al menos un criterio de búsqueda",
      });
    }

    if (dni && !/^\d{8,9}$/.test(String(dni))) {
      return res.status(400).json({
        error: "El DNI o CE debe tener de 8 a 9 dígitos númericos",
      });
    }

    // 2️⃣ Construir query segura
    const query: any = {};
    if (dni) query.dni = Number(dni);
    if (numeroOperacion) query.operationNumber = String(numeroOperacion);
    if (numeroRifa) query.tickets = { $in: [Number(numeroRifa)] };

    // 3️⃣ Buscar en DB
    const results = await Purchase.find(query)
      .populate("raffleId", "title")
      .lean<PurchaseWithRaffle[]>();

    if (!results || results.length === 0) {
      return res.status(404).json({ error: "No se encontraron resultados" });
    }

    // 4️⃣ Mapear resultados
    const mapped = results.flatMap((r) => {
      const partes = r.name.split(" ");
      const primerNombre = partes[0] || "";
      const primerApellido = partes[1] || "";

      let estadoTraducido = "DESCONOCIDO";
      if (r.status === "PAID") {
        estadoTraducido = "CONFIRMADO - El pago fue validado correctamente.";
      } else if (r.status === "PENDING") {
        estadoTraducido = "PENDIENTE - El pago está en proceso de validación.";
      } else if (r.status === "FAILED") {
        estadoTraducido =
          "FALLIDO - Número de operación inválido o el monto es menor al costo de la rifa.";
      }

      return r.tickets.map((ticket: number) => ({
        nombreCompleto: `${primerNombre} ${primerApellido}`.trim(),
        numeroRifa: ticket,
        numeroOperacion: r.operationNumber,
        fechaCompra: new Date(r.createdAt).toLocaleDateString("es-PE"),
        estado: estadoTraducido,
        nombreRifa: r.raffleId?.title || "Sin nombre",
      }));
    });

    res.json(mapped);
  } catch (error) {
    console.error("❌ Error en búsqueda de compras:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

