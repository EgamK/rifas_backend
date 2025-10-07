/*import { CorsOptions } from 'cors'

export const corsConfig: CorsOptions = {
    origin: function(origin, callback) {
        const whitelist = [process.env.FRONTEND_URL,"http://localhost:5173",]

        if(process.argv[2] === '--api') {
            whitelist.push(undefined)
        }

        if(whitelist.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Error de CORS'))
        }
    }
}*/
//import { CorsOptions } from "cors";

/**export const corsConfig: CorsOptions = {
  origin: function (origin, callback) {
    const whitelist = [process.env.FRONTEND_URL];

    // Permitir Postman y servidor local (sin origin)
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Error de CORS"));
    }
  },
  credentials: true, // para permitir cookies/autenticación si las usas
};*/
  //uptask_backend/src/config/cors.ts
import { CorsOptions } from "cors";

const whitelist = [
  process.env.FRONTEND_URL,   // ✅ Frontend en Vercel
  "https://www.rifasganaya.pe",
  "http://localhost:5173",    // ✅ Desarrollo local
];

export const corsConfig: CorsOptions = {
  origin: function (origin, callback) {
    // Permitir si no hay origin (ej: Postman o cURL)
    if (!origin) {
      return callback(null, true);
    }

    if (whitelist.includes(origin)) {
      callback(null, true);
    } else {
      console.error("❌ Bloqueado por CORS:", origin);
      callback(new Error("Error de CORS"));
    }
  },
  credentials: true, // si necesitas enviar cookies / headers de autorización
};