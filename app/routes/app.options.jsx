import { useState } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const TYPE_LABELS = {
  select: "Dropdown Select",
  swatch: "Color Swatch",
  text: "Text Field",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const options = await prisma.customOption.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return { options };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    await prisma.customOption.deleteMany({
      where: { id: form.get("id"), shop: session.shop },
    });
    return { ok: true };
  }

  const title = (form.get("title") || "").toString().trim();
  const type = form.get("type");
  if (!title || !TYPE_LABELS[type]) {
    return { ok: false };
  }

  await prisma.customOption.create({
    data: {
      shop: session.shop,
      productId: null,
      title,
      type,
      required: form.get("required") === "true",
      values: [],
    },
  });
  return { ok: true };
};

export default function Options() {
  const { options } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [type, setType] = useState("select");
  const [required, setRequired] = useState(true);

  const busy = fetcher.state !== "idle";
  const isSaving = busy && fetcher.formData?.get("intent") === "create";

  const handleSave = () => {
    if (!title.trim()) return;
    fetcher.submit(
      { intent: "create", title, type, required: String(required) },
      { method: "post" },
    );
    setTitle("");
  };

  const handleDelete = (id) => {
    fetcher.submit({ intent: "delete", id }, { method: "post" });
  };

  return (
    <s-page heading="Product Customizer" inlineSize="large">
      <s-stack gap="base">
        <s-text tone="neutral">
          Manage personalized options for your store products
        </s-text>

        <s-grid gridTemplateColumns="1fr 2fr" gap="base">
          <s-section heading="Create option group">
            <s-stack gap="base">
              <s-text-field
                label="Option title"
                placeholder="e.g. Gift Wrapping, Ribbon Color"
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
              <s-select
                label="Display type"
                value={type}
                onChange={(e) => setType(e.currentTarget.value)}
              >
                <s-option value="select">Dropdown Select</s-option>
                <s-option value="swatch">Color Swatch</s-option>
                <s-option value="text">Text Field</s-option>
              </s-select>
              <s-checkbox
                label="Mark as required field"
                checked={required}
                onChange={(e) => setRequired(e.currentTarget.checked)}
              />
              <s-button
                variant="primary"
                onClick={handleSave}
                loading={isSaving}
                disabled={!title.trim()}
              >
                Save option group
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading={`Active options (${options.length})`} padding="none">
            {options.length === 0 ? (
              <s-box padding="large">
                <s-text tone="neutral">
                  No custom options yet. Create your first one using the panel
                  on the left.
                </s-text>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Name</s-table-header>
                  <s-table-header>Type</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header></s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {options.map((o) => (
                    <s-table-row key={o.id}>
                      <s-table-cell>{o.title}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone="info">
                          {TYPE_LABELS[o.type] || o.type}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={o.required ? "warning" : "neutral"}>
                          {o.required ? "Required" : "Optional"}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200">
                          <s-button
                            variant="tertiary"
                            onClick={() => navigate(`/app/options/${o.id}`)}
                          >
                            Manage choices
                          </s-button>
                          <s-button
                            tone="critical"
                            variant="tertiary"
                            onClick={() => handleDelete(o.id)}
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
        </s-grid>
      </s-stack>
    </s-page>
  );
}