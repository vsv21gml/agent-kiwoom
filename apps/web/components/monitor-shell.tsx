"use client";

import { useEffect, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Burger,
  Container,
  Group,
  NavLink,
  Text,
  Title,
} from "@mantine/core";
import {
  IconBrandGoogle,
  IconClipboardList,
  IconFileText,
  IconHome2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconNews,
  IconPencil,
  IconTransfer,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LiveToggle } from "@/components/live-toggle";

type ShellProps = {
  children: React.ReactNode;
};

const navItems = [
  { href: "/strategy", label: "Strategy", icon: IconPencil },
  { href: "/reports", label: "Reports", icon: IconFileText },
  { href: "/news-logs", label: "News", icon: IconNews },
  { href: "/trades", label: "Trade Logs", icon: IconTransfer },
  { href: "/api-logs", label: "API Logs", icon: IconClipboardList },
  { href: "/llm-logs", label: "LLM Logs", icon: IconBrandGoogle },
] as const;

export function MonitorShell({ children }: ShellProps) {
  const [opened, setOpened] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem("ui.sidebar.collapsed");
    if (stored === "true") {
      setCollapsed(true);
    }
  }, []);

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: collapsed ? 80 : 280,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={() => setOpened((value) => !value)} hiddenFrom="sm" size="sm" />
            <Title order={3}>Stock Agent</Title>
          </Group>
          <LiveToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Group justify={collapsed ? "center" : "space-between"} mb="sm" align="center" wrap="nowrap">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <Group gap="xs" align="center" wrap="nowrap">
              <IconHome2 size={16} />
              {!collapsed && (
                <Text size="sm" fw={600}>
                  Home
                </Text>
              )}
            </Group>
          </Link>
          <ActionIcon
            variant="light"
            onClick={() =>
              setCollapsed((value) => {
                const next = !value;
                if (typeof window !== "undefined") {
                  localStorage.setItem("ui.sidebar.collapsed", String(next));
                }
                return next;
              })
            }
            aria-label="toggle sidebar"
          >
            {collapsed ? <IconLayoutSidebarLeftExpand size={16} /> : <IconLayoutSidebarLeftCollapse size={16} />}
          </ActionIcon>
        </Group>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={collapsed ? undefined : item.label}
              leftSection={<Icon size={16} />}
              active={active}
              onClick={() => setOpened(false)}
            />
          );
        })}
      </AppShell.Navbar>

      <AppShell.Main style={{ height: "calc(100vh - 64px)", overflow: "hidden" }}>
        <Container
          fluid
          px="md"
          h="100%"
          style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", paddingTop: 16, paddingBottom: 16 }}
        >
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
