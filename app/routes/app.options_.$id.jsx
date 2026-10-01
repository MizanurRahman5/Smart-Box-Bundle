import { useState } from "react";
import { randomUUID } from "node:crypto";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncAddonConfig } from "../utils/syncConfig.server";

const ADDON_TAG = "smart-box-addon";

function assertNoErrors(errors) {
  if (errors && errors.length) throw new Error(JSON.stringify(errors));
}

// ★ পরিবর্তন ১: শেষে `image` parameter যোগ হয়েছে
async function createAddonProduct(admin, label, price, image) {
  // 1. লুকানো (Unlisted) product বানানো
  const createRes = await admin.graphql(
    `#graphql
    mutation CreateAddon($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          variants(first: 1) { nodes { id } }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        product: {
          title: `${label} (Add-on)`,
          status: "UNLISTED",
          productType: "Add-on",
          tags: [ADDON_TAG],
        },
      },
    },
  );
  const created = (await createRes.json()).data.productCreate;
  assertNoErrors(created.userErrors);
  const productId = created.product.id;
  const variantGid = created.product.variants.nodes[0].id;

  // 2. দাম বসানো
  const priceRes = await admin.graphql(
    `#graphql
    mutation SetPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        variants: [{ id: variantGid, price: price.toFixed(2) }],
      },
    },
  );
  assertNoErrors((await priceRes.json()).data.productVariantsBulkUpdate.userErrors);

  // ★ পরিবর্তন ২: ছবি যোগ করা (ব্যর্থ হলেও add-on তৈরি আটকাবে না)
  if (image) {
    try {
      const mediaRes = await admin.graphql(
        `#graphql
        mutation AddImage($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
          productUpdate(product: $product, media: $media) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            product: { id: productId },
            media: [
              {
                originalSource: image,
                alt: label,
                mediaContentType: "IMAGE",
              },
            ],
          },
        },
      );
      const errs = (await mediaRes.json()).data?.productUpdate?.userErrors;
      if (errs?.length) console.error("Add-on image error", errs);
    } catch (e) {
      console.error("Could not add add-on image", e);
    }
  }

  // 3. Online Store-এ প্রকাশ করা
  const pubRes = await admin.graphql(
    `#graphql
    query { publications(first: 20) { nodes { id name } } }`,
  );
  const pubs = (await pubRes.json()).data.publications.nodes;
  const online = pubs.find((p) => p.name === "Online Store");
  if (online) {
    const publishRes = await admin.graphql(
      `#graphql
      mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
      { variables: { id: productId, input: [{ publicationId: online.id }] } },
    );
    assertNoErrors((await publishRes.json()).data.publishablePublish.userErrors);
  }

  return { productId, variantId: variantGid.split("/").pop() };
}

async function deleteAddonProduct(admin, productId) {
  await admin.graphql(
    `#graphql
    mutation DeleteAddon($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        userErrors { field message }
      }
    }`,
    { variables: { input: { id: productId } } },
  );
}

async function getGroup(request, params) {
  const { admin, session } = await authenticate.admin(request);
  const group = await prisma.customOption.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!group) throw new Response("Not found", { status: 404 });
  return { group, admin, shop: session.shop };
}

export const loader = async ({ request, params }) => {
  const { group } = await getGroup(request, params);
  return { group };
};

export const action = async ({ request, params }) => {
  const { group, admin, shop } = await getGroup(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  const values = Array.isArray(group.values) ? group.values : [];
  let next = values;

  if (intent === "add") {
    const label = (form.get("label") || "").toString().trim();
    if (!label) return { ok: false };
    const price = Math.max(0, Number(form.get("price")) || 0);
    const image = (form.get("image") || "").toString().trim();

    let variantId = null;
    let addonProductId = null;
    if (price > 0) {
      // ★ পরিবর্তন ৩: এখানে `image` পাঠানো হচ্ছে
      const addon = await createAddonProduct(admin, label, price, image);
      variantId = addon.variantId;
      addonProductId = addon.productId;
    }

    next = [
      ...values,
      {
        id: randomUUID(),
        label,
        image: image || null,
        price,
        variantId,
        addonProductId,
      },
    ];
  } else if (intent === "delete") {
    const target = values.find((v) => v.id === form.get("valueId"));
    if (target?.addonProductId) {
      try {
        await deleteAddonProduct(admin, target.addonProductId);
      } catch (e) {
        console.error("Could not delete add-on product", e);
      }
    }
    next = values.filter((v) => v.id !== form.get("valueId"));
  }

  await prisma.customOption.update({
    where: { id: group.id },
    data: { values: next },
  });
  await syncAddonConfig(admin, shop);
  return { ok: true };
};

export default function Choices() {
  const { group } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const choices = Array.isArray(group.values) ? group.values : [];

  const [label, setLabel] = useState("");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState("0");

  const isSaving =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "add";

  const handleAdd = () => {
    if (!label.trim()) return;
    fetcher.submit({ intent: "add", label, image, price }, { method: "post" });
    setLabel("");
    setImage("");
    setPrice("0");
  };

  return (
    <s-page heading={group.title} inlineSize="large">
      <s-button
        slot="secondary-actions"
        onClick={() => navigate("/app/options")}
      >
        Back to options
      </s-button>

      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr 2fr" gap="base">
          <s-section heading="Add choice">
            <s-stack gap="base">
              <s-text-field
                label="Choice name"
                placeholder="e.g. Red Ribbon"
                value={label}
                onInput={(e) => setLabel(e.currentTarget.value)}
              />
              <s-text-field
                label="Image URL (optional)"
                placeholder="https://..."
                value={image}
                onInput={(e) => setImage(e.currentTarget.value)}
              />
              <s-number-field
                label="Price (0 = free)"
                min="0"
                value={price}
                onInput={(e) => setPrice(e.currentTarget.value)}
              />
              <s-button
                variant="primary"
                onClick={handleAdd}
                loading={isSaving}
                disabled={!label.trim()}
              >
                Add choice
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading={`Choices (${choices.length})`} padding="none">
            {choices.length === 0 ? (
              <s-box padding="large">
                <s-text tone="neutral">
                  No choices yet. Add your first one using the panel on the
                  left.
                </s-text>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Image</s-table-header>
                  <s-table-header listSlot="primary">Name</s-table-header>
                  <s-table-header>Price</s-table-header>
                  <s-table-header></s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {choices.map((c) => (
                    <s-table-row key={c.id}>
                      <s-table-cell>
                        {c.image ? (
                          <s-thumbnail src={c.image} size="small" alt={c.label} />
                        ) : (
                          "—"
                        )}
                      </s-table-cell>
                      <s-table-cell>{c.label}</s-table-cell>
                      <s-table-cell>
                        {c.price > 0 ? (
                          c.price
                        ) : (
                          <s-badge tone="success">Free</s-badge>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          onClick={() =>
                            fetcher.submit(
                              { intent: "delete", valueId: c.id },
                              { method: "post" },
                            )
                          }
                        >
                          Delete
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}
