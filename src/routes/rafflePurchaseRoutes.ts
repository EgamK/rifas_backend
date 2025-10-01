// backend/routes/rafflePurchaseRoutes.ts
import express from "express";
import { searchPurchases, purchaseSearchLimiter } from "../controllers/rafflePurchaseController";

const router = express.Router();

// GET /api/purchases/search?dni=...&numeroOperacion=...&numeroRifa=...
router.get("/search", searchPurchases, purchaseSearchLimiter );

export default router;
