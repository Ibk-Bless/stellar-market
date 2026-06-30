import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import SkillCombobox from "@/components/SkillCombobox";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SkillCombobox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders existing skills as removable chips", () => {
    render(<SkillCombobox skills={["React", "Node.js"]} onChange={jest.fn()} />);
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Node.js")).toBeInTheDocument();
  });

  it("fetches suggestions from /skills?q= after a debounced keystroke", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { skills: [{ id: "1", name: "React", category: "Frontend" }] },
    });

    render(<SkillCombobox skills={[]} onChange={jest.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rea" } });

    await waitFor(
      () => expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("/skills"),
        expect.objectContaining({ params: { q: "rea" } }),
      ),
      { timeout: 1000 },
    );
  });

  it("adds a suggestion as a chip when clicked", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { skills: [{ id: "1", name: "React", category: "Frontend" }] },
    });
    const onChange = jest.fn();

    render(<SkillCombobox skills={[]} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rea" } });

    const option = await screen.findByText("React", {}, { timeout: 1000 });
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(["React"]);
  });

  it("removes a skill when its remove button is clicked", () => {
    const onChange = jest.fn();
    render(<SkillCombobox skills={["React"]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Remove React"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("allows adding a custom skill not in the taxonomy via Enter", () => {
    mockedAxios.get.mockResolvedValue({ data: { skills: [] } });
    const onChange = jest.fn();

    render(<SkillCombobox skills={[]} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Astro" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["Astro"]);
  });
});
