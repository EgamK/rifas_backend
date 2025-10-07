import { Request, Response, NextFunction } from "express";

export const originGuard = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Dominios permitidos (solo tu web)
  const allowed = ["https://rifasganaya.pe", "https://www.rifasganaya.pe","http://localhost:5173/"];

  const isAllowed =
    (origin && allowed.includes(origin)) ||
    (referer && allowed.some((url) => referer.startsWith(url)));

  if (isAllowed) {
    next(); // ✅ Permitir
  } else {
    res.status(403).json({ error: "Acceso no autorizado" });
  }
};
