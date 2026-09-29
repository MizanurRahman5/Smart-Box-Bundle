import { useState } from "react";
import { randomUUID } from "node:crypto";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncAddonConfig } from "../utils/syncConfig.server";

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
    next = [
      ...values,
      { id: randomUUID(), label, image: image || null, price, variantId: null },
    ];
  } else if (intent === "delete") {
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