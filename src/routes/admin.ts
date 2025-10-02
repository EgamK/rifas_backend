import { Router } from "express";
import { listPurchases, confirmPurchase, rejectPurchase } from "../controllers/raffleController";
import { authenticate } from '../middleware/auth'

const router = Router();
router.use(authenticate)

// admin.ts
router.get("/", listPurchases);
router.patch("/purchases/:id/pay", confirmPurchase);
router.patch("/purchases/:id/reject", rejectPurchase);
export default router;
