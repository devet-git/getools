// Kiểu dữ liệu chung cho bộ chuyển đổi định dạng file (chạy hoàn toàn trên trình duyệt).

export type ConvertGroup = 'image' | 'document' | 'spreadsheet' | 'data' | 'audio';

/** Tuỳ chọn mà một converter có thể dùng; trang chỉ hiện điều khiển tương ứng khi converter khai báo. */
export type OptionKey = 'quality' | 'dpi';

export interface ConvertOptions {
  /** Chất lượng JPG/WebP, 0.1–1. */
  quality: number;
  /** Độ phân giải khi vẽ trang PDF thành ảnh. */
  dpi: number;
}

export const DEFAULT_OPTIONS: ConvertOptions = { quality: 0.9, dpi: 150 };

export interface ConvertOutput {
  blob: Blob;
  name: string;
}

export interface Converter {
  id: string;
  /** Nhãn hiển thị trong ô chọn định dạng đích. */
  label: string;
  /** Phần mở rộng đầu vào (chữ thường, không dấu chấm). */
  from: string[];
  /** Phần mở rộng đầu ra. */
  to: string;
  group: ConvertGroup;
  options?: OptionKey[];
  /** Giới hạn riêng (byte) nếu thấp hơn giới hạn chung. */
  maxBytes?: number;
  convert(file: File, opts?: Partial<ConvertOptions>): Promise<ConvertOutput[]>;
}
