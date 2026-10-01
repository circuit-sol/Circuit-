"use strict";

const express = require("express");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { requireAuth } = require("./sessionAuth");

const BUCKET = "collection-images";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_BYTES / 3);
const EDITION_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IMAGE_FILE_PATTERN = /^[a-f0-9-]+\.(jpg|png|webp)$/;

const SQL_ERRORS = {
  INVALID_OR_EXPIRED_SESSION: 401,
  EDITION_NOT_FOUND: 404,
  BRAND_ACCESS_DENIED: 403,
  INVALID_IMAGE_ACTION: 400,
  INVALID_IMAGE_PAYLOAD: 400,
  INVALID_IMAGE_PATH: 400,
  INVALID_IMAGE_URL: 400,
  INVALID_IMAGE_TAG: 400,
  IMAGE_ALREADY_ATTACHED: 409,
  EDITION_IMAGE_LIMIT_REACHED: 409,
};

function fail(status, code) {
  const error = new Error(code);
  error.status = status;
  error.publicCode = code;
  throw error;
}

function respondWithError(res, error) {
  if (error.status && error.publicCode) {
    return res.status(error.status).json({
      error: error.publicCode,
    });
  }

  if (error.code === "P0001" && SQL_ERRORS[error.message]) {
    return res.status(SQL_ERRORS[error.message]).json({
      error: error.message,
    });
  }

  console.error("Edition image operation failed:", error.message);

  return res.status(500).json({
    error: "EDITION_IMAGE_OPERATION_FAILED",
  });
}

module.exports = function createEditionImageRoutes(supabase) {
  const router = express.Router();

  router.use(requireAuth);

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  function validateBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(400, "INVALID_REQUEST_BODY");
    }

    if (
      typeof body.id !== "string" ||
      !EDITION_ID_PATTERN.test(body.id) ||
      Buffer.byteLength(body.id, "utf8") > 32
    ) {
      fail(400, "INVALID_EDITION_ID");
    }
  }

  async function authorizeEdition(req, editionId) {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, wallet_address")
      .eq("id", req.auth.userId)
      .maybeSingle();

    if (userError) throw userError;

    if (!user || user.wallet_address !== req.auth.walletAddress) {
      fail(401, "INVALID_OR_EXPIRED_SESSION");
    }

    const { data: edition, error: editionError } = await supabase
      .from("editions")
      .select("id, brand_id, images")
      .eq("id", editionId)
      .maybeSingle();

    if (editionError) throw editionError;
    if (!edition) fail(404, "EDITION_NOT_FOUND");

    const { data: membership, error: membershipError } = await supabase
      .from("brand_memberships")
      .select("role")
      .eq("brand_id", edition.brand_id)
      .eq("user_id", req.auth.userId)
      .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership || !["owner", "editor"].includes(membership.role)) {
      fail(403, "BRAND_ACCESS_DENIED");
    }

    return edition;
  }

  function imagePrefix(edition) {
    return `brands/${edition.brand_id}/editions/${edition.id}/`;
  }

  async function updateImageList(req, action, image) {
    return supabase.rpc("manage_edition_image", {
      p_edition_id: req.body.id,
      p_user_id: req.auth.userId,
      p_wallet_address: req.auth.walletAddress,
      p_action: action,
      p_image: image,
    });
  }

  async function removeStoredFile(filePath) {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([filePath]);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Image cleanup failed:", filePath, error.message);
      return false;
    }
  }

  // Mounted at POST /api/editions/image
  router.post("/", async (req, res) => {
    try {
      validateBody(req.body);

      const edition = await authorizeEdition(req, req.body.id);

      if ((edition.images || []).length >= 10) {
        fail(409, "EDITION_IMAGE_LIMIT_REACHED");
      }

      const { base64Data, contentType, tag = "" } = req.body;

      if (typeof tag !== "string" || tag.length > 100) {
        fail(400, "INVALID_IMAGE_TAG");
      }

      if (typeof base64Data !== "string" || !base64Data.length) {
        fail(400, "INVALID_IMAGE_DATA");
      }

      // Accept raw Base64 or a standard image data URL.
      let encoded = base64Data;
      let dataUrlType;

      if (encoded.startsWith("data:")) {
        const comma = encoded.indexOf(",");
        const header = encoded.slice(0, comma);
        const match = /^data:(image\/(?:jpeg|png|webp));base64$/.exec(header);

        if (comma < 0 || !match) {
          fail(400, "INVALID_IMAGE_DATA_URL");
        }

        dataUrlType = match[1];
        encoded = encoded.slice(comma + 1);
      }

      if (encoded.length > MAX_BASE64_LENGTH) {
        fail(413, "IMAGE_TOO_LARGE");
      }

      if (
        !encoded.length ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      ) {
        fail(400, "INVALID_BASE64");
      }

      const input = Buffer.from(encoded, "base64");

      if (input.toString("base64") !== encoded) {
        fail(400, "INVALID_BASE64");
      }

      if (input.length > MAX_BYTES) {
        fail(413, "IMAGE_TOO_LARGE");
      }

      const options = {
        limitInputPixels: 12000000,
        failOn: "warning",
      };

      let metadata;

      try {
        metadata = await sharp(input, options).metadata();
      } catch {
        fail(400, "INVALID_IMAGE_OR_DIMENSIONS");
      }

      const formats = {
        jpeg: { mime: "image/jpeg", extension: "jpg" },
        png: { mime: "image/png", extension: "png" },
        webp: { mime: "image/webp", extension: "webp" },
      };

      const format = formats[metadata.format];

      if (!format || (metadata.pages || 1) > 1) {
        fail(400, "UNSUPPORTED_IMAGE_TYPE");
      }

      if (
        (contentType !== undefined && contentType !== format.mime) ||
        (dataUrlType && dataUrlType !== format.mime)
      ) {
        fail(400, "IMAGE_CONTENT_TYPE_MISMATCH");
      }

      let output;

      try {
        output = await sharp(input, options)
          .rotate()
          .toFormat(metadata.format)
          .toBuffer();
      } catch {
        fail(400, "INVALID_IMAGE");
      }

      if (output.length > MAX_BYTES) {
        fail(413, "PROCESSED_IMAGE_TOO_LARGE");
      }

      // Never use a caller-provided filename as the storage path.
      const filePath =
        imagePrefix(edition) + randomUUID() + "." + format.extension;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, output, {
          contentType: format.mime,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Image upload failed:", uploadError.message);
        fail(502, "IMAGE_UPLOAD_FAILED");
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

      const image = {
        path: filePath,
        url: urlData.publicUrl,
        tag: tag.trim(),
      };

      let result;

      try {
        result = await updateImageList(req, "add", image);
      } catch (error) {
        // A lost response does not prove the transaction failed.
        console.error("Image attachment outcome unknown:", filePath);
        return res.status(503).json({
          error: "IMAGE_ATTACHMENT_UNCONFIRMED",
          path: filePath,
        });
      }

      if (result.error) {
        if (result.error.code === "P0001" && SQL_ERRORS[result.error.message]) {
          // The function explicitly rejected the change.
          await removeStoredFile(filePath);
          throw result.error;
        }

        // Retain the file rather than risk deleting an attached image.
        console.error(
          "Image attachment outcome requires checking:",
          filePath,
          result.error.message,
        );

        return res.status(503).json({
          error: "IMAGE_ATTACHMENT_UNCONFIRMED",
          path: filePath,
        });
      }

      return res.status(201).json({
        publicUrl: image.url,
        image,
        edition: result.data,
      });
    } catch (error) {
      return respondWithError(res, error);
    }
  });

  // Mounted at DELETE /api/editions/image
  router.delete("/", async (req, res) => {
    try {
      validateBody(req.body);

      const edition = await authorizeEdition(req, req.body.id);
      const filePath = req.body.path;
      const prefix = imagePrefix(edition);

      if (
        typeof filePath !== "string" ||
        !filePath.startsWith(prefix) ||
        !IMAGE_FILE_PATTERN.test(filePath.slice(prefix.length))
      ) {
        fail(400, "INVALID_IMAGE_PATH");
      }

      // Detach first so a failed storage deletion leaves no broken cover.
      // Repeating this request also retries storage cleanup.
      const { data, error } = await updateImageList(req, "remove", {
        path: filePath,
      });

      if (error) throw error;

      const removed = await removeStoredFile(filePath);

      return res.status(removed ? 200 : 202).json({
        success: removed,
        detached: true,
        cleanupPending: !removed,
        path: filePath,
        edition: data,
      });
    } catch (error) {
      return respondWithError(res, error);
    }
  });

  return router;
};
