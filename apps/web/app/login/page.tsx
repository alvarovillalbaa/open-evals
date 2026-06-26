import { AuthForm } from "./auth-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-sm">
        <p className="text-sm font-semibold">open-evals</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-normal">Sign in</h1>
        <div className="mt-6">
          <AuthForm mode="login" />
        </div>
      </section>
    </main>
  );
}
