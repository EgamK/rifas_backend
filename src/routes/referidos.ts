import express from "express";
import { validarCodigoRef } from "../controllers/referidoController";

const router = express.Router();

// GET /api/referidos/:codRef
router.get("/:codRef", validarCodigoRef);

export default router;
