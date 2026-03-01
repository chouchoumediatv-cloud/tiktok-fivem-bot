require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const Stripe = require("stripe");
const cors = require("cors");

const app = express();

/* ======================================================
   SECURITE GLOBALE PROCESS
====================================================== */

process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED REJECTION:", err);
});

/* ======================================================
   VARIABLES ENVIRONNEMENT
====================================================== */

const PORT = process.env.PORT || 3000;
console.log("📡 PORT détecté :", PORT);

const SECRET = process.env.FIVEM_HTTP_SECRET || "CHANGE_ME_SECRET";

const FIVEM_HTTP_URL =
  process.env.FIVEM_HTTP_URL ||
  "http://91.164.130.95:30120/tiktok_webhook_receiver/tiktok";

const BASE_URL =
  process.env.BASE_URL ||
  `http://localhost:${PORT}`;

/* ======================================================
   STRIPE SECURISE
====================================================== */

let stripe = null;

if (process.env.STRIPE_SECRET_KEY) {
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  console.log("✅ Stripe initialisé");
} else {
  console.log("⚠️ STRIPE_SECRET_KEY manquante");
}

/* ======================================================
   MIDDLEWARES
====================================================== */

app.use(cors());
app.use(express.json());

/* ======================================================
   ROUTES HEALTHCHECK (IMPORTANT POUR RAILWAY)
====================================================== */

app.get("/", (req, res) => {
  res.status(200).send("🚀 Server is running");
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.get("/ping", (req, res) => {
  console.log("🏓 Ping reçu");
  res.send("pong");
});

/* ======================================================
   STRIPE WEBHOOK (RAW BODY OBLIGATOIRE)
====================================================== */

app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    if (!stripe) {
      return res.status(500).send("Stripe non configuré");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Erreur signature Stripe :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const code = session.metadata?.code;
      const type = session.metadata?.type;

      console.log("💰 Paiement validé :", code, type);

      if (code) {
        try {
          await fetch(FIVEM_HTTP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: SECRET,
              action:
                type === "lifetime"
                  ? "activate_lifetime"
                  : "activate_sub",
              code: code,
            }),
          });

          console.log("✅ Activation envoyée à FiveM");
        } catch (err) {
          console.error("❌ Erreur activation FiveM :", err.message);
        }
      }
    }

    res.json({ received: true });
  }
);

/* ======================================================
   CREATION CHECKOUT STRIPE
====================================================== */

app.post("/create-checkout-session", async (req, res) => {

  if (!stripe) {
    return res.status(500).json({ error: "Stripe non configuré" });
  }

  const { code, type } = req.body || {};

  if (!code || !type) {
    return res.status(400).json({ error: "Missing code or type" });
  }

  let priceId;
  let mode;

  if (type === "monthly") {
    priceId = "price_1T5kNQBLXiYPk7rhYxxOQEZK";
    mode = "subscription";
  } else if (type === "lifetime") {
    priceId = "price_1T5kX7BLXiYPk7rhRPGjrOfv";
    mode = "payment";
  } else {
    return res.status(400).json({ error: "Invalid type" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        code: code,
        type: type,
      },
      success_url: `${BASE_URL}/success`,
      cancel_url: `${BASE_URL}/cancel`,
    });

    console.log("✅ Session Stripe créée :", session.id);
    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Stripe error :", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   WEBHOOK STREAM TO EARN / TIKTOK
====================================================== */

app.post("/webhook", async (req, res) => {

  console.log("🔥 Webhook reçu !");
  console.log("Query code:", req.query.code);
  console.log("Body:", req.body);

  const code = req.query.code;

  if (!code) {
    console.log("❌ Code manquant");
    return res.status(400).send("Code manquant");
  }

  try {
    const payload = {
      secret: SECRET,
      code: code,
      event: req.body.event,
      amount: req.body.amount,
      distance: req.body.distance,
      duration: req.body.duration,
    };

    console.log("➡ Envoi vers FiveM:", payload);

    const response = await fetch(FIVEM_HTTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("📡 Réponse FiveM status:", response.status);
    console.log("✅ Envoyé à FiveM");

    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erreur TikTok -> FiveM :", err.message);
    res.status(500).send("Erreur HTTP");
  }
});

/* ======================================================
   START SERVER (RAILWAY SAFE)
====================================================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Serveur lancé sur port " + PORT);
});