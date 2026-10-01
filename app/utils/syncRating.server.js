import prisma from "../db.server";

export async function syncProductRating(admin, shop, productId) {
  const agg = await prisma.productReview.aggregate({
    where: { shop, productId, isApproved: true },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const count = agg._count.rating;
  const average = count ? Math.round((agg._avg.rating || 0) * 100) / 100 : 0;
  const ownerId = `gid://shopify/Product/${productId}`;

  const res = await admin.graphql(
    `#graphql
    mutation SetRating($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "sbb_reviews",
            key: "rating",
            type: "number_decimal",
            value: String(average),
          },
          {
            ownerId,
            namespace: "sbb_reviews",
            key: "count",
            type: "number_integer",
            value: String(count),
          },
        ],
      },
    },
  );

  const errors = (await res.json()).data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(JSON.stringify(errors));
}