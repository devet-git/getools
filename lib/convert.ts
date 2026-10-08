/** Đổi đơn vị (kể cả đơn vị Việt Nam) và tiền tệ với tỷ giá do người dùng quản lý. */

export interface Unit { id: string; label: string; /** hệ số về đơn vị gốc của nhóm */ f: number }
export interface UnitGroup { id: string; label: string; units: Unit[] }

export const UNIT_GROUPS: UnitGroup[] = [
  { id: 'length', label: 'Chiều dài', units: [
    { id: 'mm', label: 'Milimét (mm)', f: 0.001 }, { id: 'cm', label: 'Xentimét (cm)', f: 0.01 }, { id: 'm', label: 'Mét (m)', f: 1 },
    { id: 'km', label: 'Kilômét (km)', f: 1000 }, { id: 'in', label: 'Inch (in)', f: 0.0254 }, { id: 'ft', label: 'Foot (ft)', f: 0.3048 },
    { id: 'yd', label: 'Yard (yd)', f: 0.9144 }, { id: 'mi', label: 'Dặm (mile)', f: 1609.344 }, { id: 'nmi', label: 'Hải lý', f: 1852 },
  ] },
  { id: 'mass', label: 'Khối lượng', units: [
    { id: 'mg', label: 'Miligam (mg)', f: 0.000001 }, { id: 'g', label: 'Gam (g)', f: 0.001 }, { id: 'kg', label: 'Kilôgam (kg)', f: 1 },
    { id: 'ta', label: 'Tạ (100 kg)', f: 100 }, { id: 'tan', label: 'Tấn', f: 1000 }, { id: 'lb', label: 'Pound (lb)', f: 0.45359237 },
    { id: 'oz', label: 'Ounce (oz)', f: 0.028349523125 }, { id: 'luong', label: 'Lượng / cây vàng (37,5 g)', f: 0.0375 },
    { id: 'chi', label: 'Chỉ vàng (3,75 g)', f: 0.00375 }, { id: 'ozt', label: 'Troy ounce (vàng thế giới)', f: 0.0311034768 },
  ] },
  { id: 'area', label: 'Diện tích', units: [
    { id: 'cm2', label: 'cm²', f: 0.0001 }, { id: 'm2', label: 'm²', f: 1 }, { id: 'ha', label: 'Héc-ta (ha)', f: 10000 },
    { id: 'km2', label: 'km²', f: 1e6 }, { id: 'sqft', label: 'Square foot (ft²)', f: 0.09290304 }, { id: 'acre', label: 'Acre', f: 4046.8564224 },
    { id: 'sao-bb', label: 'Sào Bắc Bộ (360 m²)', f: 360 }, { id: 'sao-tb', label: 'Sào Trung Bộ (500 m²)', f: 500 },
    { id: 'cong', label: 'Công đất Nam Bộ (1.000 m²)', f: 1000 }, { id: 'mau-bb', label: 'Mẫu Bắc Bộ (3.600 m²)', f: 3600 },
  ] },
  { id: 'volume', label: 'Thể tích', units: [
    { id: 'ml', label: 'Mililít (ml)', f: 0.001 }, { id: 'l', label: 'Lít (l)', f: 1 }, { id: 'm3', label: 'm³', f: 1000 },
    { id: 'tsp', label: 'Thìa cà phê (tsp, 5 ml)', f: 0.005 }, { id: 'tbsp', label: 'Thìa canh (tbsp, 15 ml)', f: 0.015 },
    { id: 'cup', label: 'Cup (240 ml)', f: 0.24 }, { id: 'floz', label: 'fl oz (US)', f: 0.0295735295625 }, { id: 'gal', label: 'Gallon (US)', f: 3.785411784 },
  ] },
  { id: 'speed', label: 'Tốc độ', units: [
    { id: 'ms', label: 'm/s', f: 1 }, { id: 'kmh', label: 'km/h', f: 1 / 3.6 }, { id: 'mph', label: 'mph', f: 0.44704 }, { id: 'kn', label: 'Hải lý/giờ (knot)', f: 0.514444 },
  ] },
  { id: 'data', label: 'Dung lượng dữ liệu', units: [
    { id: 'b', label: 'Byte', f: 1 }, { id: 'kb', label: 'KB (1.000)', f: 1e3 }, { id: 'mb', label: 'MB (1.000²)', f: 1e6 }, { id: 'gb', label: 'GB (1.000³)', f: 1e9 }, { id: 'tb', label: 'TB (1.000⁴)', f: 1e12 },
    { id: 'kib', label: 'KiB (1.024)', f: 1024 }, { id: 'mib', label: 'MiB (1.024²)', f: 1024 ** 2 }, { id: 'gib', label: 'GiB (1.024³)', f: 1024 ** 3 }, { id: 'tib', label: 'TiB (1.024⁴)', f: 1024 ** 4 },
  ] },
  { id: 'time', label: 'Thời lượng', units: [
    { id: 's', label: 'Giây', f: 1 }, { id: 'min', label: 'Phút', f: 60 }, { id: 'h', label: 'Giờ', f: 3600 }, { id: 'd', label: 'Ngày', f: 86400 },
    { id: 'w', label: 'Tuần', f: 604800 }, { id: 'mo', label: 'Tháng (30,44 ngày)', f: 2629746 }, { id: 'y', label: 'Năm (365,25 ngày)', f: 31557600 },
  ] },
];

export function convertUnit(value: number, from: Unit, to: Unit): number {
  return (value * from.f) / to.f;
}

export type TempUnit = 'C' | 'F' | 'K';
export function convertTemp(v: number, from: TempUnit, to: TempUnit): number {
  const c = from === 'C' ? v : from === 'F' ? ((v - 32) * 5) / 9 : v - 273.15;
  return to === 'C' ? c : to === 'F' ? (c * 9) / 5 + 32 : c + 273.15;
}

/** Tỷ giá: số VND cho 1 đơn vị ngoại tệ. Giá trị mặc định chỉ để tham khảo — người dùng nên cập nhật. */
export const DEFAULT_RATES: Record<string, number> = {
  VND: 1, USD: 25400, EUR: 27500, JPY: 165, KRW: 18.5, CNY: 3500, GBP: 32300, AUD: 16700, SGD: 18800, THB: 700, CAD: 18500, CHF: 29000,
};
export const CURRENCY_NAMES: Record<string, string> = {
  VND: 'Việt Nam Đồng', USD: 'Đô la Mỹ', EUR: 'Euro', JPY: 'Yên Nhật', KRW: 'Won Hàn Quốc', CNY: 'Nhân dân tệ', GBP: 'Bảng Anh',
  AUD: 'Đô la Úc', SGD: 'Đô la Singapore', THB: 'Baht Thái', CAD: 'Đô la Canada', CHF: 'Franc Thụy Sĩ',
};

export function convertCurrency(v: number, from: string, to: string, rates: Record<string, number>): number {
  const a = rates[from], b = rates[to];
  if (!a || !b) return NaN;
  return (v * a) / b;
}
