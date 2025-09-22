import mongoose, { Schema, Document } from 'mongoose'

export interface IRaffle extends Document {
  title: string
  description?: string
  ticketPrice: number
  totalTickets: number
  soldTickets: number
  photos: string[] // Cloudinary URLs
  startAt?: Date
  endAt?: Date
}

const RaffleSchema: Schema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  ticketPrice: {
    type: Number,
    required: true,
  },
  totalTickets: {
    type: Number,
    required: true,
  },
  soldTickets: {
    type: Number,
    default: 0,
  },
  photos: {
    type: [String],
    default: [],
  },
  startAt: Date,
  endAt: Date,
}, { timestamps: true })

// 🔹 Middleware opcional: al borrar una rifa, limpiar fotos en Cloudinary
// RaffleSchema.pre('deleteOne', { document: true }, async function() {
//   for (const url of this.photos) {
//     await cloudinary.uploader.destroy(extraerPublicId(url))
//   }
// })

const Raffle = mongoose.model<IRaffle>('Raffle', RaffleSchema)
export default Raffle
