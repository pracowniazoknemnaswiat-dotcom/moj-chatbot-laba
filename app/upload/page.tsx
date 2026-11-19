import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthConfig, isSessionValid, SESSION_COOKIE } from "@/lib/auth";
import { DocumentError, listDocuments } from "@/lib/documents";
import type { DocumentSummary } from "@/lib/knowledge-shared";
import KnowledgeBase from "./knowledge-base";
import styles from "./upload.module.css";

// Baza wiedzy – tylko po zalogowaniu. Bez sesji przekierowanie do hasła,
// zanim dotkniemy bazy. Import, lista i usuwanie: /api/documents.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Upload />
    </Suspense>
  );
}

async function Upload() {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = getAuthConfig();
  if (!config || !isSessionValid(token, config)) redirect("/");

  let documents: DocumentSummary[] = [];
  let error: string | null = null;
  try {
    documents = await listDocuments();
  } catch (e) {
    if (!(e instanceof DocumentError)) throw e;
    error = `${e.message} ${e.hint}`;
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Baza wiedzy</h1>
        <Link className={styles.back} href="/">
          ← Czat
        </Link>
      </div>
      <p className={styles.intro}>
        Wklej dokument Pracowni, np. cennik albo regulamin. Każdy akapit (tekst oddzielony pustą
        linią) stanie się osobnym fragmentem, z którego agent będzie mógł korzystać. Dokument
        o tym samym tytule zastępuje poprzednią wersję.
      </p>
      <KnowledgeBase initialDocuments={documents} initialError={error} />
    </main>
  );
}
