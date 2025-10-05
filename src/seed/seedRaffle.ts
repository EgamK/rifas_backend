import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary";
import Raffle from "../models/Raffle";

async function uploadFile(filePath: string) {
  return cloudinary.uploader.upload(filePath, { folder: "rifas" });
}

async function run() {
  const MONGO = process.env.DATABASE_URL!;
  if (!MONGO) throw new Error("MONGO_URI not set");
  await mongoose.connect(MONGO);
  console.log("Connected to MongoDB");

  // clean previous demo raffle (optional)
  await Raffle.deleteMany({});

  const seedDir = path.join(process.cwd(), "seed_images");
  if (!fs.existsSync(seedDir)) {
    console.error("Crea la carpeta backend/seed_images y pon 5 imágenes (carro1.jpg ...)");
    process.exit(1);
  }

  const files = fs.readdirSync(seedDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).slice(0,5);
  if (files.length < 1) {
    console.error("No hay imágenes en seed_images");
    process.exit(1);
  }

  const uploadedUrls: string[] = [];
  for (const fname of files) {
    const p = path.join(seedDir, fname);
    console.log("Uploading", p);
    const res = await uploadFile(p);
    uploadedUrls.push(res.secure_url);
  }

  const raffle = await Raffle.create({
    title: "Suzuki New Vitara GL LUX6 – 2019 / Moto Scooters / iPhone",
    description: "Caracteristicas Del Premio Mayor: 🚗 Motor 1.6 cc, ⚙️ Transmisión Automática, 🎨 C Anaranjado/Negro, ❄️ Aire Acondicionado, 🛣️ Control de Crucero, 📷 Cámara de Retroceso y 🛡️ Sensores de Seguridad.",
    ticketPrice: 20,
    totalTickets: 1000,
    soldTickets: 0,
    photos: uploadedUrls,
  });

  console.log("Raffle created:", raffle._id);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
