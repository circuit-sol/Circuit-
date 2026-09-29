"use strict";

const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");

// Use a dedicated secret, separate from legacy wallet encryption.
const JWT_SECRET = process.env.JWT_SECRET;

// Fail at startup rather than issue tokens with an insecure default.
if (!JWT_SECRET || JWT_SECRET.length < 64) {
  throw new Error("JWT_SECRET must contain at least 64 characters");
}

// These values bind tokens to Circuit's authentication service and API.
const JWT_ISSUER = "circuit-auth";
const JWT_AUDIENCE = "circuit-api";

// Session duration is separate from the challenge's five-minute expiry.
const SESSION_SECONDS = 60 * 60;

/**
 * Issue a Circuit session after wallet ownership has been verified.
 * This token contains no private keys, email, or admin privileges.
 */
// TODO: Confirm Invalid
// function issueSession(walletAddress) {
//   const token = jwt.sign({ tokenType: "access" }, JWT_SECRET, {
//     algorithm: "HS256",
//     subject: walletAddress,
//     issuer: JWT_ISSUER,
//     audience: JWT_AUDIENCE,
//     jwtid: randomUUID(),
//     expiresIn: SESSION_SECONDS,
//   });

//   return {
//     token,
//     tokenType: "Bearer",
//     expiresIn: SESSION_SECONDS,
//   };
// }
// TODO: Confirm completely valid
// Issue a session whose subject is the user's database ID.
function issueSession(user) {
  const token = jwt.sign(
    {
      tokenType: "access",
      tokenVersion: 2,
      walletAddress: user.wallet_address,
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      subject: user.id,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: randomUUID(),
      expiresIn: SESSION_SECONDS,
    },
  );

  return {
    token,
    tokenType: "Bearer",
    expiresIn: SESSION_SECONDS,
  };
}

/**
 * Protect an endpoint using:
 * Authorization: Bearer <Circuit token>
 *
 * Successful verification attaches trusted identity to req.auth.
 * Resource ownership and admin permissions must still be checked
 * by the endpoint using this identity.
 */
function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    // Verify the signature, expiry, issuer, audience, and algorithm.
    // Merely decoding a JWT would not authenticate it.
    const payload = jwt.verify(match[1], JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // // Reject tokens that do not match our access-token structure.
    // if (
    //   typeof payload !== "object" ||
    //   payload.tokenType !== "access" ||
    //   typeof payload.sub !== "string" ||
    //   typeof payload.exp !== "number" ||
    //   typeof payload.jti !== "string"
    // ) {
    //   throw new Error("Invalid session claims");
    // }

    // Reject tokens issued using the previous wallet-only format.
    if (
      typeof payload !== "object" ||
      payload.tokenType !== "access" ||
      payload.tokenVersion !== 2 ||
      typeof payload.sub !== "string" ||
      typeof payload.walletAddress !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.jti !== "string"
    ) {
      throw new Error("Invalid session claims");
    }

    // Downstream routes must use this verified identity,
    // rather than trusting a wallet address submitted in the body.
    // req.auth = {
    //   walletAddress: payload.sub,
    //   sessionId: payload.jti,
    // };
    // Make verified account identity available to protected routes.
    req.auth = {
      userId: payload.sub,
      walletAddress: payload.walletAddress,
      sessionId: payload.jti,
    };

    return next();
  } catch {
    return res.status(401).json({
      error: "INVALID_OR_EXPIRED_SESSION",
    });
  }
}

module.exports = { issueSession, requireAuth };
