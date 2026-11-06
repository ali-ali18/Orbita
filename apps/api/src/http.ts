import type { DeviceRecord } from "@orbita/db";
import type { ApiError, DeviceDto } from "@orbita/shared";

export function apiError(code: string, message: string): ApiError {
	return { error: { code, message } };
}

export function toDeviceDto(d: DeviceRecord): DeviceDto {
	return { id: d.id, name: d.name, createdAt: d.createdAt.toISOString() };
}
