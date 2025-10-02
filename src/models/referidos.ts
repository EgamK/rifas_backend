import mongoose, { Schema, Document } from "mongoose";

export interface IReferido extends Document {
  name: string;
  dni: number;
  telefono: number;
  email: string;
  codRef: string;
  startAt?: Date;
  endAt?: Date;
}

const ReferidoSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    dni: { type: Number, required: true },
    telefono: { type: Number, required: true },
    email: { type: String, required: true, trim: true },
    codRef: { type: String, required: true, unique: true }, // 👈 importante: único
    //codRef: {type: mongoose.Schema.Types.ObjectId, ref: "Referido", required: false},
    startAt: Date,
    endAt: Date,
  },
  { timestamps: true }
);

const Referido = mongoose.model<IReferido>("Referido", ReferidoSchema);
export default Referido;

