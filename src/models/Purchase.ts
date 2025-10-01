import mongoose, { Schema, Document } from "mongoose";

export interface IPurchase extends Document {
  raffleId: mongoose.Types.ObjectId;
  name: string;
  dni: number;
  phone: number;
  email: string;
  quantity: number;
  amount: number;
  tickets: number[];
  method: string;
  status: "PENDING" | "PAID" | "FAILED";
  operationNumber: string;
  codRef?: string; // 👈 referencia opcional
  // 👇 agrega esto para que TS no se queje
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseSchema: Schema = new Schema(
  {
    raffleId: {
      type: Schema.Types.ObjectId,
      ref: "Raffle",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    dni: { type: Number, required: true },
    phone: { type: Number, required: true },
    email: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    amount: { type: Number, required: true },
    tickets: [{ type: Number, required: true }],
    method: { type: String, required: true }, // ej: yape, plin, etc.
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED"],
      default: "PENDING",
    },
    operationNumber: {
      type: String,
      required: true,
      unique: true, // 👈 evita duplicados
      trim: true,
      sparse: true,
    },
    codRef: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

const Purchase = mongoose.model<IPurchase>("Purchase", PurchaseSchema);
export default Purchase;
