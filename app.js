import express from "express";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  query,
  updateDoc,
  where,
  getDocs,
  increment,
} from "firebase/firestore";
import midtransClient from "midtrans-client";
import cors from "cors";
import morgan from "morgan";
import swaggerUI from "swagger-ui-express";
import swaggerJsDoc from "swagger-jsdoc";
import assetLinks from './assetslink.json' assert {type: 'json'};

dotenv.config();

let app = express();

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Marcha API",
      version: "1.0.0",
      description: "Web API for Marcha Social Payment App",
    },
    servers: [
      {
        url: "https://marcha-api-production.up.railway.app/",
      },
    ],
  },
  apis: ["./app.js"],
};

const specs = swaggerJsDoc(options);

const apiKey = process.env.apiKey;
const authDomain = process.env.authDomain;
const projectId = process.env.projectId;
const storageBucket = process.env.storageBucket;
const messagingSenderId = process.env.messagingSenderId;
const appId = process.env.appId;

const PORT = process.env.PORT || 3000;

const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
};

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.SERVER_KEY,
  clientKey: process.env.CLIENT_KEY,
});

app.use(express.urlencoded({ extended: true })); // to support URL-encoded POST body
app.use(express.json()); // to support parsing JSON POST body
app.use(cors());
app.use(morgan("dev"));
app.use(function (req, res, next) {
  // Website you wish to allow to connect
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Request methods you wish to allow
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, PATCH, DELETE"
  );

  // Request headers you wish to allow
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-Requested-With,content-type"
  );

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader("Access-Control-Allow-Credentials", true);

  // Pass to next layer of middleware
  next();
});

app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(specs));

app.get("/", (req, res) => {
  res.redirect("/api-docs");
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Transaction:
 *       type: object
 *       required:
 *         - customers
 *         - items
 *       properties:
 *         customers:
 *           type: object
 *           properties:
 *             email:
 *               type: string
 *             first_name:
 *               type: string
 *             last_name:
 *               type: string
 *             phone:
 *               type: string
 *         items:
 *           type: array
 *           properties:
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               price:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *               name:
 *                 type: string
 *         callbacks:
 *           type: object
 *           properties:
 *             url:
 *               type: string
 *         order_id:
 *           type: string
 */

/**
 * @swagger
 * tags:
 *   name: Transaction
 *   description: Managing transaction API
 */

/**
 * @swagger
 * tags:
 *   name: User
 *   description: Managing user API
 */

/**
 * @swagger
 * /charge:
 *   post:
 *     summary: Create a new transaction token
 *     tags: [Transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Transaction'
 *     responses:
 *       200:
 *         description: The transaction token was successfully created
 *       500:
 *         description: Some server error
 */
app.post("/charge", function (req, res) {
  let body = req.body;

  let gross_amount = 0;
  let items = body.items;
  let customers = body.customers;
  let url = body.url;

  items.forEach(function (item) {
    gross_amount += item.price * item.quantity;
  });
  let orderIdRand = body.order_id;
  let parameter = {
    transaction_details: {
      order_id: "order-id-" + orderIdRand,
      gross_amount: gross_amount,
    },
    customer_details: customers,
    item_details: items,
    callbacks: {
      finish: url,
    },
  };

  // create snap transaction token
  snap
    .createTransactionToken(parameter)
    .then((transactionToken) => {
      res.status(200).json({ token: transactionToken });
    })
    .catch((e) => {
      res.status(404).json({
        status_code: "404",
        error_message: e,
      });
    });
});

/**
 * @swagger
 * /det/{transaction_id}:
 *   get:
 *     summary: Get a transaction detail by transaction_id
 *     tags: [Transaction]
 *     parameters:
 *       - in: path
 *         name: transaction_id
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: an transaction detail
 *       404:
 *         description: transaction_id was not found
 */
app.get("/det/:transaction_id", function (req, res) {
  let transaction_id = {
    transaction_id: req.params.transaction_id,
  };
  snap.transaction
    .notification(transaction_id)
    .then((transactionStatusObject) => {
      let summary = transactionStatusObject;
      res.status(200).send(summary);
    })
    .catch(() => {
      res.status(404).json({
        status_code: "404",
        status_message: "Transaction id not found",
      });
    });
});

app.get("/start-app", function (req, res) {
  res.status(301).redirect("https://marchaa.vercel.app/")
});

app.get("/.well-known/assetlinks.json", function (req, res) {
  res.json(assetLinks);
})

app.post("/notification_handler", function (req, res) {
  let receivedJson = req.body;
  snap.transaction
    .notification(receivedJson)
    .then(async (transactionStatusObject) => {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);

      let orderId = transactionStatusObject.order_id;
      let transactionStatus = transactionStatusObject.transaction_status;
      let gross_amount = transactionStatusObject.gross_amount;
      let payment_type = transactionStatusObject.payment_type;

      const q = query(collection(firestoreDb, "orders"), where("orderId", "==", orderId));
      const docSnap = await getDocs(q);
      const id = docSnap.docs[0].id;
      const uid = docSnap.docs[0].data().customerId;

      if (payment_type == 'cstore') {
        await updateDoc(doc(firestoreDb, "orders", id), {
          methodPayment: transactionStatusObject.store,
          status: transactionStatus,
          token: transactionStatusObject.payment_code,
        });

        if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
          await updateDoc(doc(firestoreDb, "users", uid), {
            balance: increment(parseInt(gross_amount)),
          });
        }
      } else if (payment_type == 'gopay' || payment_type == 'qris' || payment_type == 'shopeepay') {
        await updateDoc(doc(firestoreDb, "orders", id), {
          methodPayment: payment_type,
          status: transactionStatus,
        });

        if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
          await updateDoc(doc(firestoreDb, "users", uid), {
            balance: increment(parseInt(gross_amount)),
          });
        }
      } else if (payment_type == 'bank_transfer') {
        if (transactionStatusObject.permata_va_number != null) {
          await updateDoc(doc(firestoreDb, "orders", id), {
            methodPayment: 'permata',
            status: transactionStatus,
            token: transactionStatusObject.permata_va_number,
          });

          if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
            await updateDoc(doc(firestoreDb, "users", uid), {
              balance: increment(parseInt(gross_amount)),
            });
          }
        } else {
          await updateDoc(doc(firestoreDb, "orders", id), {
            methodPayment: transactionStatusObject.va_numbers[0].bank,
            status: transactionStatus,
            token: transactionStatusObject.va_numbers[0].va_number,
          });

          if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
            await updateDoc(doc(firestoreDb, "users", uid), {
              balance: increment(parseInt(gross_amount)),
            });
          }
        }
      }


      res.status(200).send(transactionStatusObject);
    })
    .catch(() => {
      res.status(404).json({
        status_code: "404",
        status_message: "Transaction id not found",
      });
    });
});

app.listen(PORT, () => {
  console.log("Server started on " + PORT);
});
