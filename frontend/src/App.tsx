import { FormEvent, useState } from "react";
import "./App.css";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type Product = "azure" | "m365";

export default function App() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [product, setProduct] = useState<Product>("azure");
    const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
    const [message, setMessage] = useState("");

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setStatus("loading");
        setMessage("");
        try {
            const url = apiBase ? `${apiBase.replace(/\/$/, "")}/submit` : "/api/submit";
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email, phone, product }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus("err");
                setMessage(typeof data.error === "string" ? data.error : "Request failed");
                return;
            }
            setStatus("ok");
            setMessage("Accepted — processing in the background.");
        } catch {
            setStatus("err");
            setMessage("Network error — is the API running?");
        }
    }

    return (
        <div className="card">
            <h1>Request demo</h1>
            <p className="lede">
                Submit triggers a Service Bus message and a Durable Functions workflow.
            </p>
            <form onSubmit={onSubmit}>
                <label>
                    Name
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        autoComplete="name"
                    />
                </label>
                <label>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                    />
                </label>
                <label>
                    Phone
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        autoComplete="tel"
                    />
                </label>
                <fieldset>
                    <legend>Product</legend>
                    <label className="radio">
                        <input
                            type="radio"
                            name="product"
                            checked={product === "azure"}
                            onChange={() => setProduct("azure")}
                        />
                        Azure
                    </label>
                    <label className="radio">
                        <input
                            type="radio"
                            name="product"
                            checked={product === "m365"}
                            onChange={() => setProduct("m365")}
                        />
                        Microsoft 365
                    </label>
                </fieldset>
                <button type="submit" disabled={status === "loading"}>
                    {status === "loading" ? "Sending…" : "Submit"}
                </button>
            </form>
            {message && (
                <p className={`feedback ${status === "err" ? "error" : "success"}`}>{message}</p>
            )}
        </div>
    );
}
