  import express from 'express'
  import dotenv from 'dotenv'
  import cors from 'cors'
  import morgan from 'morgan'
  import path from 'path'

  import { corsConfig } from './config/cors'
  import { connectDB } from './config/db'

  // Rutas existentes
  import authRoutes from './routes/authRoutes'
  import projectRoutes from './routes/projectRoutes'

  // Nueva ruta para rifas
  import raffleRoutes from './routes/raffleRoutes'

  //para Page ADMINISTRADOR
  import adminRoutes from "./routes/admin";

  import referidoRoutes from "./routes/referidos";




  dotenv.config()
  connectDB()

  const app = express()

  // Middlewares
  app.use(cors(corsConfig))
  app.use(morgan('dev'))
  app.use(express.json({ limit: '10mb' })) // soporte JSON grande (ej: imágenes base64)

  // Servir archivos si algún día guardas imágenes localmente
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

  // Rutas
  app.use('/api/auth', authRoutes)
  app.use('/api/projects', projectRoutes)
  app.use('/api/raffles', raffleRoutes) // 👈 NUEVO endpoint
  app.use("/api/admin", adminRoutes);

  app.use("/api/referidos", referidoRoutes);


  export default app
