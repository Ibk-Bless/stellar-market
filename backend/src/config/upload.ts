import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Allowed MIME types
export const ALLOWED_MIME_TYPES = [
  "application/pdf", // PDF
  "image/jpeg", // JPG
  "image/png", // PNG
  "video/mp4", // MP4
  "application/zip", // ZIP
];

// Max file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = ["image/jpeg", "image/png"];

export const PORTFOLIO_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per portfolio file
export const PORTFOLIO_MAX_ITEMS = 10;
export const PORTFOLIO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");

export const AVATAR_UPLOAD_DIR =
  process.env.AVATAR_UPLOAD_DIR || path.join(UPLOAD_DIR, "avatars");

export const PORTFOLIO_UPLOAD_DIR =
  process.env.PORTFOLIO_UPLOAD_DIR || path.join(UPLOAD_DIR, "portfolio");

if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(PORTFOLIO_UPLOAD_DIR)) {
  fs.mkdirSync(PORTFOLIO_UPLOAD_DIR, { recursive: true });
}

// Upload directory (ensure after AVATAR_UPLOAD_DIR for env)

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random hash
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

// File filter for validation
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new Error(
        `Invalid file type. Allowed types: PDF, JPG, PNG, MP4, ZIP, DOCX`,
      ),
    );
  }

  cb(null, true);
};

// Configure multer
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

export { UPLOAD_DIR };

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, AVATAR_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const ext = path.extname(file.originalname) || (file.mimetype === "image/png" ? ".png" : ".jpg");
    cb(null, `avatar-${uniqueSuffix}${ext}`);
  },
});

const avatarFileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Avatar must be JPG or PNG."));
  }
  cb(null, true);
};

export const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: AVATAR_MAX_SIZE },
});

const portfolioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, PORTFOLIO_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const ext = path.extname(file.originalname);
    cb(null, `portfolio-${uniqueSuffix}${ext}`);
  },
});

const portfolioFileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!PORTFOLIO_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Portfolio files must be JPG, PNG, GIF, WebP, or PDF."));
  }
  cb(null, true);
};

export const portfolioUpload = multer({
  storage: portfolioStorage,
  fileFilter: portfolioFileFilter,
  limits: { fileSize: PORTFOLIO_MAX_FILE_SIZE },
});

