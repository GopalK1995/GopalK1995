import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Field, Form, FormField, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

const schema = z.object({ name: z.string().min(2, "Enter at least 2 characters") });
type Values = z.infer<typeof schema>;

function FormDemo({ onOk }: { onOk: (v: Values) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  return (
    <Form form={form} onSubmit={onOk}>
      <FormField name="name" label="Name" render={(p) => <Input id={p.id} name={p.name} value={String(p.value ?? "")} onChange={(e) => p.onChange(e.target.value)} onBlur={p.onBlur} aria-invalid={p["aria-invalid"]} aria-describedby={p["aria-describedby"]} />} />
      <Button variant="primary" type="submit">Save</Button>
    </Form>
  );
}

describe("Field", () => {
  it("links label, help and error to the control", () => {
    cy.mount(<Field label="Email" help="Work address" error="Required"><Input /></Field>);
    cy.get("input").should("have.attr", "aria-invalid", "true").invoke("attr", "aria-describedby").should("match", /\S+ \S+/);
    cy.contains("label", "Email").click();
    cy.focused().should("match", "input");
  });
});

describe("Form", () => {
  it("shows the validation error, then submits", () => {
    const onOk = cy.stub().as("ok");
    cy.mount(<FormDemo onOk={onOk} />);
    cy.contains("button", "Save").click();
    cy.get("[role=alert]").should("contain", "Enter at least 2 characters");
    cy.get("input").type("Asha");
    cy.contains("button", "Save").click();
    cy.get("@ok").should("have.been.calledOnce");
  });
});
