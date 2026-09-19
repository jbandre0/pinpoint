import { notFound } from "next/navigation";
import CountryDetail from "@/components/CountryDetail";
import { getAllRecords, getFamily, getRecord } from "@/lib/countries";

// Pre-render a route for every record — countries and regional profiles.
export function generateStaticParams() {
  return getAllRecords().map((r) => ({ id: r.id }));
}

export function generateMetadata({ params }: { params: { id: string } }) {
  const record = getRecord(params.id);
  return { title: record ? `${record.name} · Pin Point` : "Pin Point" };
}

export default function CountryPage({ params }: { params: { id: string } }) {
  const record = getRecord(params.id);
  if (!record) notFound();

  const family = getFamily(record.id).map((r) => ({
    id: r.id,
    name: r.name,
    isNational: !r.parent,
  }));

  const parent = (record.parent ? getRecord(record.parent) : null) ?? undefined;

  return <CountryDetail country={record} family={family} parent={parent} />;
}
