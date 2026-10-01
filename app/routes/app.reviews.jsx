import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProductRating } from "../utils/syncRating.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const reviews = await prisma.productReview.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // product-এর সংখ্যার বদলে নাম দেখানোর জন্য
  const titles = {};
  const ids = [...new Set(reviews.map((r) => r.productId))];
  if (ids.length) {
    try {
      const res = await admin.graphql(
        `#graphql
        query ProductTitles($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product { id title }
          }
        }`,
        {
          variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) },
        },
      );
      const data = (await res.json()).data;
      (data?.nodes || []).forEach((n) => {
        if (n) titles[n.id.split("/").pop()] = n.title;
      });
    } catch (e) {
      console.error("Could not load product titles", e);
    }
  }

  return { reviews, titles };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = form.get("id");
  const where = { id, shop: session.shop };

  // মোছার আগেই জেনে নিতে হবে review-টা কোন product-এর
  const review = await prisma.productReview.findFirst({
    where,
    select: { productId: true },
  });
  if (!review) return { ok: false };

  if (intent === "approve") {
    await prisma.productReview.updateMany({
      where,
      data: { isApproved: true },
    });
  } else if (intent === "unapprove") {
    await prisma.productReview.updateMany({
      where,
      data: { isApproved: false },
    });
  } else if (intent === "delete") {
    await prisma.productReview.deleteMany({ where });
  }

  // product-এর গড় রেটিং Shopify-র খাতায় নতুন করে লেখা
  try {
    await syncProductRating(admin, session.shop, review.productId);
    return { ok: true, synced: true };
  } catch (e) {
    console.error("Could not sync product rating", e);
    return { ok: true, syncError: String(e.message || e) };
  }
};

function Stat({ label, value }) {
  return (
    <s-box
      padding="base"
      background="base"
      borderWidth="base"
      borderRadius="large"
    >
      <s-stack gap="small-200">
        <s-text tone="neutral">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

export default function Reviews() {
  const { reviews, titles } = useLoaderData();
  const fetcher = useFetcher();
  const [tab, setTab] = useState("pending");

  const pending = reviews.filter((r) => !r.isApproved);
  const approved = reviews.filter((r) => r.isApproved);
  const shown = tab === "pending" ? pending : approved;

  const act = (intent, id) =>
    fetcher.submit({ intent, id }, { method: "post" });

  return (
    <s-page heading="Customer Reviews" inlineSize="large">
      <s-stack gap="base">
        {fetcher.data?.syncError ? (
          <s-banner tone="critical" heading="Could not update the product rating">
            <s-text>{fetcher.data.syncError}</s-text>
          </s-banner>
        ) : fetcher.data?.synced ? (
          <s-banner tone="success" heading="Product rating updated on your store">
            <s-text>The product's average rating was saved.</s-text>
          </s-banner>
        ) : null}

        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <Stat label="Waiting for approval" value={pending.length} />
          <Stat label="Approved" value={approved.length} />
          <Stat label="Total" value={reviews.length} />
        </s-grid>

        <s-stack direction="inline" gap="small-200">
          <s-button
            variant={tab === "pending" ? "primary" : "tertiary"}
            onClick={() => setTab("pending")}
          >
            {`Waiting (${pending.length})`}
          </s-button>
          <s-button
            variant={tab === "approved" ? "primary" : "tertiary"}
            onClick={() => setTab("approved")}
          >
            {`Approved (${approved.length})`}
          </s-button>
        </s-stack>

        <s-section padding="none">
          {shown.length === 0 ? (
            <s-box padding="large">
              <s-text tone="neutral">
                {tab === "pending"
                  ? "No reviews are waiting for approval."
                  : "No approved reviews yet."}
              </s-text>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Rating</s-table-header>
                <s-table-header listSlot="primary">Review</s-table-header>
                <s-table-header>Product</s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {shown.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>{stars(r.rating)}</s-table-cell>
                    <s-table-cell>
                      <s-stack gap="small-300">
                        <s-text type="strong">{r.author}</s-text>
                        <s-text>
                          {r.comment.length > 140
                            ? r.comment.slice(0, 140) + "…"
                            : r.comment}
                        </s-text>
                        {r.email ? (
                          <s-text tone="neutral">{r.email}</s-text>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {titles[r.productId] || `Product ${r.productId}`}
                    </s-table-cell>
                    <s-table-cell>{String(r.createdAt).slice(0, 10)}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        {r.isApproved ? (
                          <s-button
                            variant="tertiary"
                            onClick={() => act("unapprove", r.id)}
                          >
                            Unapprove
                          </s-button>
                        ) : (
                          <s-button
                            variant="tertiary"
                            onClick={() => act("approve", r.id)}
                          >
                            Approve
                          </s-button>
                        )}
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          onClick={() => act("delete", r.id)}
                        >
                          Delete
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}