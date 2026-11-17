import { addDays, kstDate } from "@/rules/time";
import { db } from "@/server/db";
import type { TravelerInput } from "@/server/bookings";

let seq = 0;

/** 시험용 상품 + 출발일 하나. */
export async function makeDeparture(opts: {
  daysAhead?: number;
  capacity?: number;
  minPax?: number;
  priceAdult?: number;
  now?: Date;
} = {}) {
  seq++;
  const region = await db.region.upsert({
    where: { code: "japan" },
    create: { code: "japan", name: "일본" },
    update: {},
  });
  const product = await db.product.create({
    data: {
      code: `NB-TEST-${seq}-${Date.now() % 100000}`,
      name: `시험 상품 ${seq}`,
      region_id: region.id,
      country: "일본",
      cities: ["오사카"],
      nights: 3,
      days: 4,
      airline: "시험항공",
      departure_airport: "인천",
      summary: "시험",
      highlights: [],
      includes: [],
      excludes: [],
      guide: "가이드",
      travel_docs: "여권",
      base_price: opts.priceAdult ?? 1_000_000,
    },
  });
  const date = addDays(kstDate(opts.now ?? new Date()), opts.daysAhead ?? 40);
  const adult = opts.priceAdult ?? 1_000_000;
  const departure = await db.departure.create({
    data: {
      product_id: product.id,
      depart_date: date,
      return_date: addDays(date, 3),
      capacity: opts.capacity ?? 20,
      min_pax: opts.minPax ?? 10,
      price_adult: adult,
      price_child: Math.round(adult * 0.9),
      price_infant: Math.round(adult * 0.1),
      single_supplement: 200_000,
      deposit_per_person: 300_000,
    },
  });
  return { product, departure };
}

export function adultsList(n: number): TravelerInput[] {
  return Array.from({ length: n }, (_, i) => ({
    name_ko: `어른${i + 1}`,
    name_en: `KIM ADULT`,
    gender: i % 2 ? "M" : "F",
    birth_date: `198${i}-03-15`,
  }));
}

export const contact = { name: "김민지", phone: "01012345678", email: "minji@example.com" };

export function bookingInput(departureId: string, adults = 2, extra: Partial<{ guest_pin: string; userId: string | null }> = {}) {
  return {
    departure_id: departureId,
    pax: { adults, children: 0, infants: 0, single_rooms: 0 },
    contact,
    travelers: adultsList(adults),
    guest_pin: "1234",
    ...extra,
  };
}
