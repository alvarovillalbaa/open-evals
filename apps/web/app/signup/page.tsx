import { AuthForm } from "@/app/login/auth-form";

export default function SignupPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-sm">
        <p className="text-sm font-semibold">open-evals</p>
        <h1 className="mt-6 text-2xl font-semibold tracking-normal">Create account</h1>
        <div className="mt-6">
          <AuthForm mode="signup" />
        </div>
      </section>
    </main>
  );
}
