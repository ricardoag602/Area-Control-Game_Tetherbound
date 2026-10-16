import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const source = await searchParams;
  const destination = new URLSearchParams();

  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) destination.append(name, item);
    } else if (value !== undefined) {
      destination.append(name, value);
    }
  }

  const query = destination.toString();
  redirect(`/game/index.html${query ? `?${query}` : ""}`);
}
