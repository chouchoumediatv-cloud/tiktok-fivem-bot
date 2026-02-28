require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Railway injecte automatiquement le bon port
const PORT = process.env.PORT || 3000;

const SECRET = process.env.FIVEM_HTTP_SECRET || "CHANGE_ME_SECRET";

const FIVEM_HTTP_URL =
  process.env.FIVEM_HTTP_URL ||
  "http://127.0.0.1:30120/tiktok_webhook_receiver/tiktok";

// URL publique Railway (à mettre dans Railway Variables)
const BASE_URL =
  process.env.BASE_URL ||
  "http://localhost:" + PORT;

/* ======================================================
   JSON PARSER GLOBAL
====================================================== */
app.use(express.json());

/* ======================================================
   STRIPE WEBHOOK (RAW BODY UNIQUEMENT ICI)
====================================================== */
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Erreur signature Stripe :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const code = session.metadata?.code;
      const type = session.metadata?.type;

      if (code) {
        console.log("💰 Paiement validé :", code, type);

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

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe error :", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ROUTE TIKTOK
====================================================== */
app.post("/webhook", async (req, res) => {
  const code = req.query.code;

  if (!code) {
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

    await fetch(FIVEM_HTTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erreur TikTok -> FiveM :", err.message);
    res.status(500).send("Erreur HTTP");
  }
});

/* ======================================================
   ROUTES TEST
====================================================== */
app.get("/success", (req, res) => {
  res.send("✅ Paiement réussi !");
});

app.get("/cancel", (req, res) => {
  res.send("❌ Paiement annulé.");
});

/* ======================================================
   START SERVER
====================================================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Serveur lancé sur port " + PORT);
});