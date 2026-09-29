import { useLocation, useNavigate } from "react-router";

const TABS = [
  { label: "Home", path: "/app", exact: true },
  { label: "Customizer", path: "/app/options" },
  { label: "Gift Boxes", soon: true },
  { label: "Reviews", soon: true },
];

export default function NavBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isActive = (tab) =>
    tab.exact ? pathname === tab.path : pathname.startsWith(tab.path);

  return (
    <s-box padding="base" background="base" borderWidth="base">
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
        gap="base"
      >
        <s-heading>Smart Box &amp; Bundle</s-heading>

        <s-stack direction="inline" gap="small-200" alignItems="center">
          {TABS.map((tab) =>
            tab.soon ? (
              <s-stack
                key={tab.label}
                direction="inline"
                gap="small-300"
                alignItems="center"
              >
                <s-button variant="tertiary" disabled>
                  {tab.label}
                </s-button>
                <s-badge>Soon</s-badge>
              </s-stack>
            ) : (
              <s-button
                key={tab.label}
                variant={isActive(tab) ? "primary" : "tertiary"}
                onClick={() => navigate(tab.path)}
              >
                {tab.label}
              </s-button>
            ),
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}