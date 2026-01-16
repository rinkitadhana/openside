import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  onPageChange,
}) => {
  if (totalPages <= 1) return null;

  return (
    <>
      {/* Previous Page Button - Left Side */}
      <button
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0}
        className="select-none opacity-0 group-hover/pagination:opacity-100 absolute left-5 top-1/2 transform -translate-y-1/2 -translate-x-1/2 p-2 rounded-xl bg-secondary/80 backdrop-blur-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 border border-call-border cursor-pointer"
        title="Previous page"
      >
        <ChevronLeft size={20} />
      </button>

      {/* Next Page Button - Right Side */}
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage === totalPages - 1}
        className="select-none opacity-0 group-hover/pagination:opacity-100 absolute right-5 top-1/2 transform -translate-y-1/2 translate-x-1/2 p-2 rounded-xl bg-secondary/80 backdrop-blur-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 border border-call-border cursor-pointer"
        title="Next page"
      >
        <ChevronRight size={20} />
      </button>

      {/* Page Indicator - Top Right Corner */}
      <div className="hidden group-hover/pagination:block absolute top-2 right-2 bg-secondary/80 backdrop-blur-sm rounded-md px-2 py-1 text-xs text-foreground border border-call-border">
        {currentPage + 1} / {totalPages}
      </div>
    </>
  );
};

export default PaginationControls;
