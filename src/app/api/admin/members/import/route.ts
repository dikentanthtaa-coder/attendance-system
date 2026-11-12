import { adminRoute, ApiError } from "@/lib/api";
import { hasUploadedMembers, importMembers, MAX_UPLOAD_BYTES } from "@/lib/excel-import";
import { confirmOwnPassword } from "@/lib/confirm-password";

export const POST = adminRoute(async (admin, req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "invalid_input", "Please choose an Excel file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "file_too_large", "The file is larger than 4 MB. Please split it into smaller files.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new ApiError(400, "invalid_file", "Please upload an .xlsx Excel file (older .xls files must be re-saved as .xlsx).");
  }
  // The upload replaces the list already there, which can remove members and their attendance.
  if (await hasUploadedMembers()) await confirmOwnPassword(admin.id, form?.get("password"));
  return importMembers(admin, file.name, await file.arrayBuffer());
});
