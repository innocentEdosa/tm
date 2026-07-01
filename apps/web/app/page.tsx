import { Button } from "@tm/ui";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-tight">TM</h1>
      <div className="flex gap-3">
        <Button variant="primary">Get Started</Button>
        <Button variant="outline">Learn More</Button>
      </div>
    </main>
  );
}
