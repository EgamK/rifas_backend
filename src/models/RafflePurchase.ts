/*// backend/models/RafflePurchase.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IRafflePurchase extends Document {
  dni: string;
  nombre: string;
  apellido: string;
  numeroRifas: number;
  numeroOperacion: string;
  fechaCompra: Date;
  estado: string;
}

const rafflePurchaseSchema = new Schema<IRafflePurchase>(
  {
    dni: { type: String, required: true },
    nombre: { type: String, required: true },
    apellido: { type: String, required: true },
    numeroRifas: { type: Number, required: true },
    numeroOperacion: { type: String, required: true },
    fechaCompra: { type: Date, default: Date.now },
    estado: { type: String, enum: ["PENDIENTE", "CONFIRMADO", "CANCELADO"], default: "PENDIENTE" },
  },
  { timestamps: true }
);

export default mongoose.model<IRafflePurchase>(
  "RafflePurchase",
  rafflePurchaseSchema
);*/

// backend/models/RafflePurchase.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IRafflePurchase extends Document {
  raffleId: string;
  name: string; // nombre completo
  dni: number;
  operationNumber: string;
  tickets: number[]; // array de tickets
  status: string;
  createdAt: Date;
}

const rafflePurchaseSchema = new Schema<IRafflePurchase>(
  {
    raffleId: { type: String, required: true },
    name: { type: String, required: true }, // ejemplo: "Edgard Abanto Machuca"
    //dni: { type: String, required: true },
    dni: { type: Number, required: true },
    operationNumber: { type: String, required: true },
    tickets: [{ type: Number }], // se guarda como array
    status: { type: String, default: "PENDING" },
  },
  { timestamps: true }
);

export default mongoose.model<IRafflePurchase>(
  "RafflePurchase",
  rafflePurchaseSchema
);


    