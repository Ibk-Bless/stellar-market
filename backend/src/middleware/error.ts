import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from "../errors/AppError";
import { ErrorCodes } from "../errors/codes";
import { logger } from "../lib/logger";

export interface ApiError extends Error {
  statusCode?: number;
  details?: any;
  code?: string;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let code: string = ErrorCodes.INTERNAL_ERROR;
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details: any = err.details;

  if (err instanceof AppError) {
    code = err.code;
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    code = ErrorCodes.VALIDATION_ERROR;
    statusCode = 400;
    message = 'Validation Error';
    details = err.issues.map(error => ({
      field: error.path.join('.'),
      message: error.message,
      code: error.code
    }));
  } else if (err.name === 'PrismaClientKnownRequestError') {
    code = ErrorCodes.DATABASE_ERROR;
    statusCode = 400;
    message = 'Database operation failed';
    details = {
      prismaCode: (err as any).code,
      target: (err as any).meta?.target,
    };
  } else if (err.name === 'ContractSimulationError') {
    code = ErrorCodes.CONTRACT_SIMULATION_ERROR;
    statusCode = 422;
    message = err.message;
  } else if (err.name === 'JsonWebTokenError') {
    code = ErrorCodes.INVALID_TOKEN;
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    code = ErrorCodes.TOKEN_EXPIRED;
    statusCode = 401;
    message = 'Token expired';
  } else if (err.name === 'MulterError') {
    code = ErrorCodes.FILE_UPLOAD_FAILED;
    statusCode = 400;
    const multerCode = (err as any).code;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      code = ErrorCodes.FILE_TOO_LARGE;
      message = 'File too large. Avatar must be at most 2MB.';
    } else if (multerCode === 'LIMIT_UNEXPECTED_FILE') {
      code = ErrorCodes.UNEXPECTED_FIELD;
      message = "Unexpected field. Use 'avatar' for the file.";
    } else {
      message = 'File upload failed.';
    }
  }

  logger.error(
    {
      err,
      errorCode: code,
      requestId: req.requestId,
      url: req.url,
      method: req.method,
      ip: req.ip,
    },
    "Request error",
  );

  if (statusCode === 503) {
    res.setHeader("Retry-After", "30");
  }

  res.status(statusCode).json({
    code,
    message,
    requestId: req.requestId,
    ...(details && { details }),
  });
};

export const createError = (message: string, statusCode: number = 500, details?: any): ApiError => {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.details = details;
  return error;
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
