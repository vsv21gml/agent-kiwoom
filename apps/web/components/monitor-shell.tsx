"use client";

import { useState } from "react";
import {
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
  IconHome2,
  IconNews,
  IconTransfer,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LiveToggle } from "@/components/live-toggle";

type ShellProps = {
  children: React.ReactNode;
};

const navItems = [
  { href: "/", label: "Asset Overview", icon: IconHome2 },
  { href: "/trades", label: "Trage Logs", icon: IconTransfer },
  { href: "/news-logs", label: "News Logs", icon: IconNews },
  { href: "/api-logs", label: "API Logs", icon: IconClipboardList },
  { href: "/llm-logs", label: "LLM Logs", icon: IconBrandGoogle },
] as const;

export function MonitorShell({ children }: ShellProps) {
  const [opened, setOpened] = useState(false);
  const pathname = usePathname();

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: 280,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={() => setOpened((value) => !value)} hiddenFrom="sm" size="sm" />
            <Title order={3}>Agent Kiwoom Monitor</Title>
          </Group>
          <LiveToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              leftSection={<Icon size={16} />}
              active={active}
              onClick={() => setOpened(false)}
            />
          );
        })}
      </AppShell.Navbar>

      <AppShell.Main>
        <Container
          fluid
          px="md"
          h="calc(100vh - 64px)"
          style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
        >
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
