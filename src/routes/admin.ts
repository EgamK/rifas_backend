import { Router } from "express";
import { listPurchases, confirmPurchase, rejectPurchase } from "../controllers/raffleController";

const router = Router();

// admin.ts
router.get("/", listPurchases);
router.patch("/purchases/:id/pay", confirmPurchase);
router.patch("/purchases/:id/reject", rejectPurchase);
export default router;
