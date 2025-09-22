import { CorsOptions } from 'cors'

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
}
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