import { Router } from "express";
import { listRaffles, getRaffle, createRaffle, createPurchase } from "../controllers/raffleController";
import { uploadMemory } from "../config/multer";

const router = Router();

// public
router.get("/", listRaffles);
router.get("/:id", getRaffle);

// admin create raffle with images: multipart/form-data (photos)
router.post("/", uploadMemory.array("photos", 10), createRaffle);

// purchase (guest)
router.post("/:id/purchase", createPurchase);

export default router;
