// BMI, BMR, TDEE. Chỉ mang tính tham khảo, không thay thế tư vấn y tế.

export type Sex = 'male' | 'female';

export const ACTIVITY: { id: string; label: string; factor: number }[] = [
  { id: 'sedentary', label: 'Ít vận động (ngồi văn phòng)', factor: 1.2 },
  { id: 'light', label: 'Nhẹ (tập 1–3 buổi/tuần)', factor: 1.375 },
  { id: 'moderate', label: 'Vừa (tập 3–5 buổi/tuần)', factor: 1.55 },
  { id: 'heavy', label: 'Nhiều (tập 6–7 buổi/tuần)', factor: 1.725 },
  { id: 'athlete', label: 'Rất nhiều (lao động nặng / vận động viên)', factor: 1.9 },
];

export const bmi = (kg: number, cm: number): number => kg / (cm / 100) ** 2;

/** Phân loại theo ngưỡng WHO dành cho người châu Á (đồng thuận của WPRO/IASO). */
export function bmiCategoryAsia(v: number): { label: string; tone: 'warn' | 'ok' | 'bad' } {
  if (v < 18.5) return { label: 'Thiếu cân', tone: 'warn' };
  if (v < 23) return { label: 'Bình thường', tone: 'ok' };
  if (v < 25) return { label: 'Thừa cân', tone: 'warn' };
  if (v < 30) return { label: 'Tiền béo phì', tone: 'bad' };
  return { label: 'Béo phì', tone: 'bad' };
}

export function bmiCategoryWho(v: number): string {
  if (v < 18.5) return 'Thiếu cân';
  if (v < 25) return 'Bình thường';
  if (v < 30) return 'Thừa cân';
  return 'Béo phì';
}

/** Khoảng cân nặng (kg) ứng với BMI từ `lo` đến `hi` ở chiều cao `cm`. */
export const weightRange = (cm: number, lo: number, hi: number): [number, number] => [lo * (cm / 100) ** 2, hi * (cm / 100) ** 2];

/** Mifflin–St Jeor (kcal/ngày). */
export function bmr(sex: Sex, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
}

export const tdee = (bmrValue: number, factor: number): number => bmrValue * factor;
