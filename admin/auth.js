import bcrypt from "bcryptjs";

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

export const adminAuthConfigured = Boolean(
  ADMIN_USERNAME && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH)
);

export async function verifyCredentials(username, password) {
  if (!adminAuthConfigured) {
    return false;
  }

  if (String(username || "").trim() !== ADMIN_USERNAME) {
    return false;
  }

  if (ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(String(password || ""), ADMIN_PASSWORD_HASH);
  }

  return String(password || "") === ADMIN_PASSWORD;
}

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }

  return res.status(401).json({ success: false, error: "Unauthorized" });
}
