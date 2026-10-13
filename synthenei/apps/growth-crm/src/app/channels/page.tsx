import Attribution from "@/components/Attribution";
import { Mock, PageHead } from "@/components/ui";
import { leads } from "@/data/leads";

export default function ChannelsPage() {
  return (
    <>
      <PageHead title="Channels & attribution" sub="Which channel gets credit for a lead. Two simple models only; no multi-touch or modelled attribution in MVP." chips={<Mock />} />
      <Attribution leads={leads} />
    </>
  );
}
