import prisma from "../db.server";

export async function syncAddonConfig(admin, shop) {
  const groups = await prisma.customOption.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });

  const config = groups.map((g) => ({
    id: g.id,
    title: g.title,
    type: g.type,
    required: g.required,
    productId: g.productId,
    choices: Array.isArray(g.values) ? g.values : [],
  }));

  const idRes = await admin.graphql(`#graphql
    query { currentAppInstallation { id } }`);
  const ownerId = (await idRes.json()).data.currentAppInstallation.id;

  const res = await admin.graphql(
    `#graphql
    mutation SetConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "addons",
            key: "config",
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );

  const errors = (await res.json()).data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(JSON.stringify(errors));
}