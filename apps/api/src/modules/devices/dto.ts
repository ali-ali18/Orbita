import type { DeviceRecord } from "@orbita/db";
import type { DeviceDto } from "@orbita/shared";

export function toDeviceDto(d: DeviceRecord): DeviceDto {
	return { id: d.id, name: d.name, createdAt: d.createdAt.toISOString() };
}
