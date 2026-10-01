import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// GET /apps/sbb-reviews/reviews?product_id=123
// → অনুমোদিত review, গড় রেটিং আর প্রতিটা তারকার সংখ্যা ফেরত দেয়
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop");

  if (params["*"] !== "reviews" || !shop) {
    return json({ error: "Not found" }, 404);
  }

  const productId = (url.searchParams.get("product_id") || "").trim();
  if (!productId) return json({ error: "product_id is required" }, 400);

  const where = { shop, productId, isApproved: true };

  const [agg, groups, reviews] = await Promise.all([
    prisma.productReview.aggregate({
      where,
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.productReview.groupBy({
      by: ["rating"],
      where,
      _count: { rating: true },
    }),
    prisma.productReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        author: true,
        rating: true,
        comment: true,
        mediaUrls: true,
        createdAt: true,
      },
    }),
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  groups.forEach((g) => {
    distribution[g.rating] = g._count.rating;
  });

  return json({
    summary: {
      count: agg._count.rating,
      average: Math.round((agg._avg.rating || 0) * 100) / 100,
      distribution,
    },
    reviews,
  });
};

// POST /apps/sbb-reviews/reviews
// → কাস্টমারের নতুন review জমা নেয় (অনুমোদনের অপেক্ষায় থাকে)
export const action = async ({ request, params }) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop");

  if (params["*"] !== "reviews" || !shop) {
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const form = await request.formData();

  // স্প্যাম-ফাঁদ: মানুষের চোখে এই ঘর দেখা যায় না, শুধু বট এটা পূরণ করে
  if (form.get("website")) return json({ ok: true });

  const productId = (form.get("product_id") || "").toString().trim();
  const author = (form.get("author") || "").toString().trim().slice(0, 60);
  const email = (form.get("email") || "").toString().trim().slice(0, 120);
  const comment = (form.get("comment") || "").toString().trim().slice(0, 1000);
  const rating = parseInt(form.get("rating"), 10);

  if (!productId || !author || !comment || !(rating >= 1 && rating <= 5)) {
    return json(
      { error: "Please fill in your name, a rating and your review." },
      400,
    );
  }

  await prisma.productReview.create({
    data: {
      shop,
      productId,
      author,
      email: email || null,
      rating,
      comment,
      mediaUrls: [],
      isApproved: false,
    },
  });

  return json({ ok: true });
};